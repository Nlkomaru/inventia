import {
    type ItemNameMatchOutput,
    type ItemNameMatchResult,
    itemNameMatchInputSchema,
} from "../domain/item";
import {
    buildReceiptMatchIndex,
    matchLine,
    normalizeReceiptName,
} from "../domain/receipt-match";
import {
    listItemAliasesByNormalizedNames,
    listMatchableItems,
} from "../repositories/receiptRepository";
import { ItemServiceError } from "./itemService";

/**
 * 類似度候補の母集合の上限。これを超える品目数では、完全一致でも見落としが出る。
 * 切れたことは `poolTruncated` で呼び出し側へ返す。
 */
export const itemMatchPoolLimit = 2000;

/**
 * 表記の一覧を既存品目へ照合する。品目一覧と表記辞書はそれぞれ 1 クエリで読み、
 * 表記ごとに問い合わせない。完全一致と辞書の一致だけを確定とし、類似度は候補として返す
 * （呼び出し側が選ぶ前提の情報で、これだけで品目を決めない）。
 */
export const matchItemNames = async (
    db: D1Database,
    input: unknown,
): Promise<ItemNameMatchOutput> => {
    const parsed = itemNameMatchInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new ItemServiceError(
            400,
            "VALIDATION_ERROR",
            parsed.error.issues
                .map(
                    (issue) =>
                        `${issue.path.join(".") || "input"}: ${issue.message}`,
                )
                .join(", "),
        );
    }
    const { names, candidateLimit } = parsed.data;
    const normalizedByName = new Map(
        names.map((name) => [name, normalizeReceiptName(name)]),
    );
    const lookupKeys = [...new Set(normalizedByName.values())].filter(
        (key) => key.length > 0,
    );
    const [items, aliases] = await Promise.all([
        listMatchableItems(db, itemMatchPoolLimit + 1),
        listItemAliasesByNormalizedNames(db, lookupKeys),
    ]);
    const poolTruncated = items.length > itemMatchPoolLimit;
    const index = buildReceiptMatchIndex(items.slice(0, itemMatchPoolLimit));
    const results: ItemNameMatchResult[] = names.map((name) => {
        const normalized = normalizedByName.get(name) ?? "";
        const match = matchLine(
            normalized,
            {
                exact: index.exact,
                aliases,
                candidates: index.candidates,
            },
            { candidateLimit },
        );
        return {
            query: name,
            normalizedQuery: normalized,
            itemId: match.itemId,
            // 類似度は候補としてだけ返すため、確定した method は exact か alias に限る
            method: match.method,
            score: match.score,
            candidates: match.candidates,
        };
    });
    return { results, poolTruncated };
};
