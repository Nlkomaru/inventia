import {
    receiptMatchMinimumScore,
    similarityScore,
} from "../domain/receipt-match";
import {
    normalizeStoreName,
    type StoreNameMatchCandidate,
    type StoreNameMatchOutput,
    type StoreNameMatchResult,
    storeNameMatchInputSchema,
} from "../domain/store";
import {
    listStoresByIds,
    listStoresForMatching,
    type StoreRow,
} from "../repositories/storeRepository";
import { createOpenRouterEmbeddings } from "./embeddingService";
import type { StoreSearchEnv } from "./storeSearchService";
import { StoreServiceError } from "./storeService";

/**
 * 照合の母集合の上限。これを超える店舗数では完全一致でも見落としが出る。
 * 切れたことは `poolTruncated` で呼び出し側へ返す。
 */
export const storeMatchPoolLimit = 1_000;

/** 類似度計算のために正規化名を添えた母集合の 1 件。 */
interface StoreMatchPoolEntry {
    row: StoreRow;
    normalized: string;
}

// 同点候補の並びを母集合の順や Vectorize の応答順に依存させない。
// スコア降順 → 表示名昇順 → id 昇順は receipt-match.ts の候補並びと同じ規則
const compareStoreCandidates = (
    left: StoreNameMatchCandidate,
    right: StoreNameMatchCandidate,
): number => {
    if (left.score !== right.score) {
        return right.score - left.score;
    }
    if (left.name !== right.name) {
        return left.name < right.name ? -1 : 1;
    }
    return left.storeId < right.storeId
        ? -1
        : left.storeId > right.storeId
          ? 1
          : 0;
};

const collectSimilarityCandidates = (
    normalized: string,
    pool: readonly StoreMatchPoolEntry[],
    limit: number,
): StoreNameMatchCandidate[] => {
    if (limit <= 0 || normalized.length === 0) {
        return [];
    }
    const scored: StoreNameMatchCandidate[] = [];
    for (const entry of pool) {
        const score = similarityScore(normalized, entry.normalized);
        // 品目の照合と同じ下限を使う。店名だけ別の値にすると、同じレシートの
        // 明細と店名で「候補に出る/出ない」の基準が食い違う
        if (score < receiptMatchMinimumScore) {
            continue;
        }
        scored.push({
            storeId: entry.row.id,
            name: entry.row.name,
            source: "similarity",
            score,
        });
    }
    return scored.sort(compareStoreCandidates).slice(0, limit);
};

/**
 * 表記の類似度候補と意味検索の候補を 1 本の一覧へまとめる。
 *
 * 2 つの score は尺度が違って比較できないため、混ぜて並べ替えず
 * similarity の塊 → vector の塊の順に並べる。同じ店舗が両方に出たときは
 * similarity を残す（問い合わせた表記そのものが根拠で、呼び出し側が確認しやすい）。
 * 上限は source ごとに掛ける。合算に掛けると、類似度が枠を埋めた表記では
 * 意味検索の候補が常に消え、意味検索を足した意味が無くなる。
 */
export const mergeStoreMatchCandidates = (
    similarity: readonly StoreNameMatchCandidate[],
    vector: readonly StoreNameMatchCandidate[],
    limit: number,
): StoreNameMatchCandidate[] => {
    if (limit <= 0) {
        return [];
    }
    const merged = similarity.slice(0, limit);
    const seen = new Set(merged.map((candidate) => candidate.storeId));
    let added = 0;
    for (const candidate of [...vector].sort(compareStoreCandidates)) {
        if (added >= limit) {
            break;
        }
        if (seen.has(candidate.storeId)) {
            continue;
        }
        seen.add(candidate.storeId);
        merged.push(candidate);
        added += 1;
    }
    return merged;
};

const logVectorFailure = (error: unknown): void => {
    // API key など秘密情報を含み得る上流のメッセージは出さず、種別だけ記録する
    console.error("[storeMatchService] vector candidates failed", {
        errorName: error instanceof Error ? error.name : typeof error,
    });
};

/**
 * 店名の一覧を既存店舗へ照合する。母集合は 1 クエリだけ読んで表から引き、
 * 表記ごとに全件走査を繰り返さない。
 *
 * 確定するのは登録名の完全一致（`exact`）と正規化一致（`normalized`）だけで、
 * 類似度も意味検索も候補として返すに留める。同じチェーンの別支店は表記も埋め込みも
 * 極めて近く、機械的に確定させると別の店舗が黙って 1 つに統合され価格の帰属が壊れる
 * （`storeVectorMatchThreshold` の判断と同じ理由）。選ぶのは呼び出し側の仕事とする。
 */
export const matchStoreNames = async (
    env: StoreSearchEnv,
    input: unknown,
): Promise<StoreNameMatchOutput> => {
    const parsed = storeNameMatchInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new StoreServiceError(
            "STORE_INVALID_INPUT",
            parsed.error.issues
                .map(
                    (issue) =>
                        `${issue.path.join(".") || "input"}: ${issue.message}`,
                )
                .join(", "),
        );
    }
    const { names, candidateLimit } = parsed.data;
    const rows = await listStoresForMatching(env.DB, storeMatchPoolLimit + 1);
    const poolTruncated = rows.length > storeMatchPoolLimit;
    const pool = rows.slice(0, storeMatchPoolLimit);
    // 母集合の走査は 1 回だけにして、以降は表から引く。表記ごとに
    // listStoresForMatching を呼び直すと、表記の数だけ全件走査が走る
    const byName = new Map(pool.map((row) => [row.name, row]));
    const byNormalized = new Map<string, StoreRow[]>();
    const scorable: StoreMatchPoolEntry[] = [];
    for (const row of pool) {
        const normalized = normalizeStoreName(row.name);
        // 正規化すると空になる店名（記号だけの表記）はどの問い合わせとも一致させない
        if (normalized.length === 0) {
            continue;
        }
        const existing = byNormalized.get(normalized);
        if (existing) {
            existing.push(row);
        } else {
            byNormalized.set(normalized, [row]);
        }
        scorable.push({ row, normalized });
    }
    const results: StoreNameMatchResult[] = names.map((query) => {
        const normalized = normalizeStoreName(query);
        const exact = byName.get(query);
        if (exact) {
            return {
                query,
                normalizedQuery: normalized,
                storeId: exact.id,
                name: exact.name,
                method: "exact",
                candidates: [],
            };
        }
        const normalizedMatches =
            normalized.length === 0 ? [] : (byNormalized.get(normalized) ?? []);
        // 同じ正規化名の店舗が複数あるときは確定させない。どちらを選ぶかは
        // 呼び出し側にしか判断できないので、類似度 100 の候補として並べて返す
        const single =
            normalizedMatches.length === 1 ? normalizedMatches[0] : undefined;
        if (single !== undefined) {
            return {
                query,
                normalizedQuery: normalized,
                storeId: single.id,
                name: single.name,
                method: "normalized",
                candidates: [],
            };
        }
        return {
            query,
            normalizedQuery: normalized,
            storeId: null,
            name: null,
            method: null,
            candidates: collectSimilarityCandidates(
                normalized,
                scorable,
                candidateLimit,
            ),
        };
    });
    const unresolved = results.filter((result) => result.storeId === null);
    // 実行しなかった場合は true のままにする。「意味検索が要らなかった」ことを
    // 「意味検索が使えない」として返すと、呼び出し側が候補の欠落を誤って疑う
    let vectorSearchAvailable = true;
    if (candidateLimit > 0 && unresolved.length > 0) {
        try {
            // 埋め込みは 1 回でまとめて作る。表記ごとに searchStoresByVector を
            // 呼ぶと OpenRouter への往復が表記の数だけ増え、レシート解析の
            // 制限時間を圧迫する。names の上限は embedding の配列上限より小さい
            const queries = [
                ...new Set(unresolved.map((result) => result.query)),
            ];
            const embeddings = await createOpenRouterEmbeddings(
                env.DB,
                env.SETTINGS_ENCRYPTION_KEY,
                queries,
            );
            const hits: { query: string; storeId: string; score: number }[] =
                [];
            for (const [index, query] of queries.entries()) {
                const embedding = embeddings[index];
                if (!embedding) {
                    continue;
                }
                const matched = await env.VECTORIZE_STORES.query(embedding, {
                    topK: candidateLimit,
                });
                for (const match of matched.matches) {
                    hits.push({
                        query,
                        storeId: match.id,
                        score: match.score,
                    });
                }
            }
            const rowsById = new Map(pool.map((row) => [row.id, row]));
            // 母集合の上限で落ちた店舗だけを追加で読む。母集合に居る分は
            // 既にメモリにあるため、ここで読み直さない
            const missingIds = [
                ...new Set(
                    hits
                        .map((hit) => hit.storeId)
                        .filter((storeId) => !rowsById.has(storeId)),
                ),
            ];
            for (const row of await listStoresByIds(env.DB, missingIds)) {
                rowsById.set(row.id, row);
            }
            const vectorByQuery = new Map<string, StoreNameMatchCandidate[]>();
            for (const hit of hits) {
                const row = rowsById.get(hit.storeId);
                // Vectorize が返しても D1 に無い ID は削除で取り除き損ねた
                // stale なベクトル。D1 を唯一の真実とし、候補には出さない
                if (!row) {
                    continue;
                }
                const candidate: StoreNameMatchCandidate = {
                    storeId: row.id,
                    name: row.name,
                    source: "vector",
                    score: hit.score,
                };
                const existing = vectorByQuery.get(hit.query);
                if (existing) {
                    existing.push(candidate);
                } else {
                    vectorByQuery.set(hit.query, [candidate]);
                }
            }
            for (const result of unresolved) {
                result.candidates = mergeStoreMatchCandidates(
                    result.candidates,
                    vectorByQuery.get(result.query) ?? [],
                    candidateLimit,
                );
            }
        } catch (error) {
            // 意味検索は補助でしかない。API key 未設定や索引の障害で tool 全体を
            // 失敗させると、完全一致・正規化一致の価値まで失われる。
            // storeSearchService の索引更新と同じ best-effort とし、
            // 実行できなかったことだけを応答で伝える
            vectorSearchAvailable = false;
            logVectorFailure(error);
        }
    }
    return { results, poolTruncated, vectorSearchAvailable };
};
