import { z } from "zod";
import type { ItemDto } from "../domain/item";
import {
    getItem as getItemRecord,
    getItemsByIds,
    type ItemRow,
    listItems as listItemRecords,
} from "../repositories/itemRepository";
import { listReadingStatesByItemIds } from "../repositories/readingRepository";
import {
    createOpenRouterEmbeddings,
    EmbeddingServiceError,
} from "./embeddingService";
import { toItemDto } from "./itemService";

/**
 * 品目の埋め込み索引が必要とする binding だけの構造型。`Env` はこの形へ代入できる。
 * service を Cloudflare の生成型へ固定しないことで、検証用のスタブを渡せる。
 */
export interface ItemSearchEnv {
    DB: D1Database;
    VECTORIZE: VectorizeIndex;
    SETTINGS_ENCRYPTION_KEY: string;
}

const searchOptionsSchema = z.object({
    topK: z.int().min(1).max(100).default(20),
});

/**
 * 品目名だけを埋め込み対象にする。カテゴリー名や保管場所名を含めると、
 * それらを変更するたびに品目自体を更新していなくても索引が古くなるため含めない。
 */
const buildEmbeddingText = (row: Pick<ItemRow, "name">): string => row.name;

const logIndexFailure = (
    operation: string,
    itemIds: readonly string[],
    error: unknown,
): void => {
    // API key など秘密情報を含み得る上流のメッセージは出さず、種別だけ記録する
    console.error(`[itemSearchService] ${operation} failed`, {
        itemIds,
        errorName: error instanceof Error ? error.name : typeof error,
    });
};

// embeddingInputSchema の配列上限（100 件）に合わせた、embedding をまとめて
// 生成できる 1 回あたりの最大件数
const embeddingBatchSize = 100;

/**
 * 品目行の集まりから埋め込みを作り、Vectorize へ upsert する。呼び出し元は
 * rows.length が embeddingBatchSize（100 件）以下になるよう分割してから呼ぶこと。
 * reindexAllItems と indexItems の両方から使う共通のバッチ経路。
 */
const embedAndUpsertRows = async (
    env: ItemSearchEnv,
    rows: readonly Pick<ItemRow, "id" | "name">[],
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
    await env.VECTORIZE.upsert(vectors);
};

/**
 * 品目 1 件を D1 から読み直して埋め込みを作り、Vectorize へ upsert する。
 * ベクトル ID には品目 ID をそのまま使うため、同じ品目への再実行は upsert で冪等に収束する。
 * metadata にはデバッグ用の name だけを持たせ、数量や保管場所など変化しやすい値は入れない
 * （D1 を唯一の真実とし、索引は検索用の副産物として扱う）。
 *
 * best-effort: 埋め込み生成や Vectorize の失敗はここで飲み込み、呼び出し元の
 * 品目作成・更新を索引の失敗で失敗させない。
 */
export const indexItem = async (
    env: ItemSearchEnv,
    itemId: string,
): Promise<void> => {
    try {
        const row = await getItemRecord(env.DB, itemId);
        if (!row) {
            return;
        }
        await embedAndUpsertRows(env, [row]);
    } catch (error) {
        logIndexFailure("indexItem", [itemId], error);
    }
};

/**
 * 複数品目をまとめて索引する。embedding は 1 回の OpenRouter 呼び出しにつき最大
 * 100 件（embeddingInputSchema の配列上限）へ分割して直列に呼び、Vectorize への
 * upsert もバッチ単位で行う。レシート反映のように 1 リクエストで多数の品目を
 * 新規作成する経路が、品目ごとに embeddings API を直列で叩いて応答を
 * 引きずられないようにするための入口。
 *
 * best-effort: バッチ単位で失敗を飲み込み、1 バッチの失敗が残りのバッチや
 * 呼び出し元の処理を止めない。
 */
export const indexItems = async (
    env: ItemSearchEnv,
    itemIds: readonly string[],
): Promise<void> => {
    if (itemIds.length === 0) {
        return;
    }
    let rows: ItemRow[];
    try {
        rows = await getItemsByIds(env.DB, itemIds);
    } catch (error) {
        logIndexFailure("indexItems", itemIds, error);
        return;
    }
    for (let offset = 0; offset < rows.length; offset += embeddingBatchSize) {
        const batch = rows.slice(offset, offset + embeddingBatchSize);
        try {
            await embedAndUpsertRows(env, batch);
        } catch (error) {
            logIndexFailure(
                "indexItems",
                batch.map((row) => row.id),
                error,
            );
        }
    }
};

/**
 * 品目 1 件を索引から取り除く。品目削除で呼ぶ。
 *
 * best-effort: Vectorize の失敗はここで飲み込み、呼び出し元の品目削除を失敗させない。
 */
export const removeItemFromIndex = async (
    env: ItemSearchEnv,
    itemId: string,
): Promise<void> => {
    try {
        await env.VECTORIZE.deleteByIds([itemId]);
    } catch (error) {
        logIndexFailure("removeItemFromIndex", [itemId], error);
    }
};

/**
 * 全品目を索引し直す。未索引や過去の失敗を回復するための経路で、best-effort ではなく
 * 結果件数を返す。embedding は 1 リクエストあたり最大 100 件（`embeddingInputSchema` の
 * 配列上限）にまとめて呼び、Vectorize への upsert も同じ単位でバッチ実行する。
 *
 * OpenRouter API key が未設定（`EMBEDDING_NOT_CONFIGURED`）の場合はどのバッチも
 * 同じ理由で失敗するため、検出した時点で D1 の全件走査を打ち切って
 * `EmbeddingServiceError` をそのまま投げる。呼び出し側で 503 へ変換すること。
 * それ以外の理由での 1 バッチの失敗は残りのバッチを止めず、失敗した件数を
 * `failed` に積む。
 */
export const reindexAllItems = async (
    env: ItemSearchEnv,
): Promise<{ indexed: number; failed: number }> => {
    let indexed = 0;
    let failed = 0;
    let cursor: string | undefined;
    do {
        const page = await listItemRecords(env.DB, {
            sort: "name",
            limit: embeddingBatchSize,
            cursor,
        });
        if (page.items.length === 0) {
            break;
        }
        try {
            await embedAndUpsertRows(env, page.items);
            indexed += page.items.length;
        } catch (error) {
            if (
                error instanceof EmbeddingServiceError &&
                error.code === "EMBEDDING_NOT_CONFIGURED"
            ) {
                throw error;
            }
            failed += page.items.length;
            console.error("[itemSearchService] reindexAllItems batch failed", {
                errorName: error instanceof Error ? error.name : typeof error,
            });
        }
        cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return { indexed, failed };
};

/**
 * 品目名の類似検索を補助する。返すのは Vectorize の生の match ではなく、
 * match の ID で D1 を引き直した `ItemDto[]`（D1 を唯一の真実とする）。
 *
 * 索引に無い品目（未索引・索引の失敗・削除直後の反映遅延）はヒットしないため、
 * この検索は名前の部分一致検索（`listItems` の `q`）を補う手段として使い、
 * 単独の一次検索手段にしない。
 *
 * Vectorize の `query` には cursor が無くページングを提供できないため、
 * `topK`（既定 20、上限 100）で打ち切る仕様とする。呼び出し側の API/MCP でも
 * この上限を超えるページングは提供しないこと。
 *
 * API key が未設定など embedding を生成できない場合は `EmbeddingServiceError` を
 * そのまま投げる。呼び出し側で利用者向けメッセージへ変換すること。
 */
export const searchItemsByVector = async (
    env: ItemSearchEnv,
    query: string,
    options: { topK?: number } = {},
): Promise<ItemDto[]> => {
    const parsedOptions = searchOptionsSchema.safeParse(options);
    if (!parsedOptions.success) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_INPUT",
            "topK は 1 以上 100 以下の整数で指定してください。",
        );
    }
    const [embedding] = await createOpenRouterEmbeddings(
        env.DB,
        env.SETTINGS_ENCRYPTION_KEY,
        query,
    );
    if (!embedding) {
        throw new EmbeddingServiceError(
            "EMBEDDING_INVALID_RESPONSE",
            "検索クエリの embedding を生成できませんでした。",
        );
    }
    const result = await env.VECTORIZE.query(embedding, {
        topK: parsedOptions.data.topK,
    });
    if (result.matches.length === 0) {
        return [];
    }
    // getItemsByIds は 1 回の IN 句で読むため N+1 にならないが、結果順は不定なので
    // Map へ詰め直し、Vectorize が返した類似度順（result.matches の順）へ並べ直す
    const matchIds = result.matches.map((match) => match.id);
    const rowsById = new Map(
        (await getItemsByIds(env.DB, matchIds)).map((row) => [row.id, row]),
    );
    const rows = matchIds
        .map((id) => rowsById.get(id))
        .filter((row): row is ItemRow => row !== undefined);
    // Vectorize が返したのに D1 に行が無い ID は、削除で取り除き損ねた stale な
    // ベクトル。topK 枠を無駄に消費し続けないよう遅延クリーンアップするが、
    // 検索の応答をこれで遅らせたり失敗させたりしない（結果を待たず fire-and-forget）
    const staleIds = matchIds.filter((id) => !rowsById.has(id));
    if (staleIds.length > 0) {
        void env.VECTORIZE.deleteByIds(staleIds).catch((error) => {
            logIndexFailure("searchItemsByVector cleanup", staleIds, error);
        });
    }
    const readingStates = await listReadingStatesByItemIds(
        env.DB,
        rows.map((row) => row.id),
    );
    return rows.map((row) =>
        toItemDto(row, readingStates.get(row.id)?.status ?? null),
    );
};
