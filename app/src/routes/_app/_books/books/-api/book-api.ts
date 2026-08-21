import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { BookReadingItemDto } from "@/domain/item";
import {
    type ReadingStateDto,
    type ReadingStateUpsertInput,
    readingStateDtoSchema,
    readingStateUpsertSchema,
} from "@/domain/reading";

const apiErrorSchema = z.object({
    error: z
        .object({
            message: z.string().optional(),
        })
        .optional(),
});

const failure = async (response: Response): Promise<Error> => {
    const body = apiErrorSchema.safeParse(
        await response.json().catch(() => ({})),
    );
    return new Error(
        body.success && body.data.error?.message
            ? body.data.error.message
            : "読書状態を保存できませんでした",
    );
};

// Cloudflare Access が公開 URL に掛かるため、読み取りは server function から
// service を直接呼ぶ。`cloudflare:workers` と service はクライアントバンドルへ
// 漏らさないよう handler 内で動的 import する。
const bookPageSize = 100;

/**
 * 実効カテゴリー種別が `book` の品目を、読書状態ごと全件取得する。
 *
 * service の `status` 条件は「その状態が保存されている品目」だけを返すため、
 * 「読書状態なし」を表現できない。絞り込みと並べ替えは取得後に画面側で行い、
 * ここでは条件を渡さず全件を読む。
 */
export const listAllBookReadingStates = createServerFn({
    method: "GET",
}).handler(async (): Promise<BookReadingItemDto[]> => {
    const [{ env }, { listBookReadingStates }] = await Promise.all([
        import("cloudflare:workers"),
        import("@/services/readingService"),
    ]);
    const result: BookReadingItemDto[] = [];
    let cursor: string | undefined;
    do {
        // 未指定の cursor は「キーごと省略」で表す（service 側の schema は strict）
        const page = await listBookReadingStates(env.DB, {
            limit: bookPageSize,
            ...(cursor === undefined ? {} : { cursor }),
        });
        result.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return result;
});

export const setReadingState = async (
    itemId: string,
    input: ReadingStateUpsertInput,
): Promise<ReadingStateDto> => {
    const response = await fetch(
        `/api/items/${encodeURIComponent(itemId)}/reading-state`,
        {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(readingStateUpsertSchema.parse(input)),
        },
    );
    if (!response.ok) throw await failure(response);
    return readingStateDtoSchema.parse(await response.json());
};

/** 読書状態だけを消す。在庫と品目には影響しない。 */
export const clearReadingState = async (itemId: string): Promise<void> => {
    const response = await fetch(
        `/api/items/${encodeURIComponent(itemId)}/reading-state`,
        { method: "DELETE" },
    );
    if (!response.ok) throw await failure(response);
    // 本文の形は使わない（204 と JSON のどちらも返り得る）ため読み捨てる
    await response.text();
};
