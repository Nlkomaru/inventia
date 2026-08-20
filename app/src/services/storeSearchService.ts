import {
    findStoreById,
    listStores as listStoreRows,
    listStoresByIds,
    type StoreRow,
} from "../repositories/storeRepository";
import {
    createOpenRouterEmbeddings,
    EmbeddingServiceError,
} from "./embeddingService";

/**
 * 店名の埋め込み索引が必要とする binding だけの構造型。`Env` はこの形へ代入できる。
 *
 * 索引は品目とは別の `VECTORIZE_STORES` を使う。同じ索引へ混ぜると、品目検索が
 * 店舗のベクトルを「D1 に無い stale な品目」とみなして削除してしまう。
 */
export interface StoreSearchEnv {
    DB: D1Database;
    VECTORIZE_STORES: VectorizeIndex;
    SETTINGS_ENCRYPTION_KEY: string;
}

/** 店名だけを埋め込み対象にする。URL やファビコンは名前の類似度に寄与しない。 */
const buildEmbeddingText = (row: Pick<StoreRow, "name">): string => row.name;

// embeddingInputSchema の配列上限に合わせた 1 回あたりの最大件数
const embeddingBatchSize = 100;

const logIndexFailure = (
    operation: string,
    storeIds: readonly string[],
    error: unknown,
): void => {
    // API key など秘密情報を含み得る上流のメッセージは出さず、種別だけ記録する
    console.error(`[storeSearchService] ${operation} failed`, {
        storeIds,
        errorName: error instanceof Error ? error.name : typeof error,
    });
};

const embedAndUpsertRows = async (
    env: StoreSearchEnv,
    rows: readonly Pick<StoreRow, "id" | "name">[],
): Promise<void> => {
    if (rows.length === 0) {
        return;
    }
    const embeddings = await createOpenRouterEmbeddings(
        env.DB,
        env.SETTINGS_ENCRYPTION_KEY,
        rows.map((row) => buildEmbeddingText(row)),
    );
    const vectors = rows.map((row, index) => {
        const values = embeddings[index];
        if (!values) {
            throw new Error("embedding count did not match batch size");
        }
        return {
            id: row.id,
            values,
            metadata: { name: row.name },
        };
    });
    await env.VECTORIZE_STORES.upsert(vectors);
};

/**
 * 店舗 1 件を D1 から読み直して索引へ入れる。ベクトル ID に店舗 ID をそのまま
 * 使うため、改名後の再実行も upsert で同じ行へ収束する。
 *
 * best-effort: 埋め込み生成や Vectorize の失敗はここで飲み込み、呼び出し元の
 * 店舗作成・更新やレシート反映を索引の失敗で止めない。
 */
export const indexStore = async (
    env: StoreSearchEnv,
    storeId: string,
): Promise<void> => {
    try {
        const row = await findStoreById(env.DB, storeId);
        if (!row) {
            return;
        }
        await embedAndUpsertRows(env, [row]);
    } catch (error) {
        logIndexFailure("indexStore", [storeId], error);
    }
};

/**
 * 店舗 1 件を索引から取り除く。店舗削除で呼ぶ。
 *
 * best-effort: Vectorize の失敗は呼び出し元の削除を失敗させない。
 */
export const removeStoreFromIndex = async (
    env: StoreSearchEnv,
    storeId: string,
): Promise<void> => {
    try {
        await env.VECTORIZE_STORES.deleteByIds([storeId]);
    } catch (error) {
        logIndexFailure("removeStoreFromIndex", [storeId], error);
    }
};

/**
 * 全店舗を索引し直す。索引を後から足したため、既存の店舗はこれを 1 回走らせるまで
 * 類似検索に出てこない（同じ店舗が新規作成され重複する）。
 *
 * OpenRouter API key が未設定ならどのバッチも同じ理由で失敗するため、検出した
 * 時点で打ち切って `EmbeddingServiceError` を投げる。呼び出し側で 503 へ変換すること。
 */
export const reindexAllStores = async (
    env: StoreSearchEnv,
): Promise<{ indexed: number; failed: number }> => {
    let indexed = 0;
    let failed = 0;
    let cursor: { q: string | null; name: string; id: string } | null = null;
    for (;;) {
        const page = await listStoreRows(env.DB, {
            q: null,
            limit: embeddingBatchSize,
            cursor,
        });
        if (page.rows.length === 0) {
            break;
        }
        try {
            await embedAndUpsertRows(env, page.rows);
            indexed += page.rows.length;
        } catch (error) {
            if (
                error instanceof EmbeddingServiceError &&
                error.code === "EMBEDDING_NOT_CONFIGURED"
            ) {
                throw error;
            }
            failed += page.rows.length;
            console.error(
                "[storeSearchService] reindexAllStores batch failed",
                {
                    errorName:
                        error instanceof Error ? error.name : typeof error,
                },
            );
        }
        const last = page.rows.at(-1);
        if (!page.hasMore || !last) {
            break;
        }
        cursor = { q: null, name: last.name, id: last.id };
    }
    return { indexed, failed };
};

export interface StoreVectorMatch {
    store: StoreRow;
    /** Vectorize が返した cosine 類似度。1 に近いほど似ている。 */
    score: number;
}

/**
 * 店名の類似検索。返すのは Vectorize の生の match ではなく、match の ID で
 * D1 を引き直した行（D1 を唯一の真実とする）。類似度の高い順に並ぶ。
 *
 * 索引に無い店舗（未索引・索引の失敗）はヒットしないため、この検索は名前の
 * 完全一致・正規化一致を補う手段として使い、単独の判定手段にしない。
 *
 * API key が未設定など embedding を生成できない場合は `EmbeddingServiceError` を
 * そのまま投げる。呼び出し側で握るか利用者向けメッセージへ変換すること。
 */
export const searchStoresByVector = async (
    env: StoreSearchEnv,
    query: string,
    options: { topK?: number } = {},
): Promise<StoreVectorMatch[]> => {
    const topK = options.topK ?? 5;
    const [embedding] = await createOpenRouterEmbeddings(
        env.DB,
        env.SETTINGS_ENCRYPTION_KEY,
        query,
    );
    if (!embedding) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_RESPONSE",
            "店名の embedding を生成できませんでした。",
        );
    }
    const result = await env.VECTORIZE_STORES.query(embedding, { topK });
    if (result.matches.length === 0) {
        return [];
    }
    const matchIds = result.matches.map((match) => match.id);
    const rowsById = new Map(
        (await listStoresByIds(env.DB, matchIds)).map((row) => [row.id, row]),
    );
    // Vectorize が返したのに D1 に行が無い ID は、削除で取り除き損ねた stale な
    // ベクトル。topK 枠を無駄に消費し続けないよう遅延クリーンアップするが、
    // 応答をこれで遅らせたり失敗させたりしない（結果を待たず fire-and-forget）
    const staleIds = matchIds.filter((id) => !rowsById.has(id));
    if (staleIds.length > 0) {
        void env.VECTORIZE_STORES.deleteByIds(staleIds).catch((error) => {
            logIndexFailure("searchStoresByVector cleanup", staleIds, error);
        });
    }
    const matches: StoreVectorMatch[] = [];
    for (const match of result.matches) {
        const store = rowsById.get(match.id);
        if (store) {
            matches.push({ store, score: match.score });
        }
    }
    return matches;
};
