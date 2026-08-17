import { z } from "zod";
import { type ItemDto, itemDtoSchema } from "@/domain/item";
import {
    type StockHistoryResult,
    stockHistoryResultSchema,
} from "@/domain/stock";
import {
    type HistoryQuery,
    toHistoryParams,
} from "../-functions/history-query";

const itemListOutputSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});

const apiErrorSchema = z.object({
    error: z
        .object({
            message: z.string().optional(),
        })
        .optional(),
});

const request = async <T>(
    url: string,
    schema: z.ZodType<T>,
    fallbackMessage: string,
    init?: RequestInit,
): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = apiErrorSchema.safeParse(
            await response.json().catch(() => ({})),
        );
        throw new Error(
            body.success && body.data.error?.message
                ? body.data.error.message
                : fallbackMessage,
        );
    }
    return schema.parse(await response.json());
};

export const listItems = async (): Promise<ItemDto[]> => {
    const items: ItemDto[] = [];
    let cursor: string | undefined;
    do {
        const params = new URLSearchParams({ limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const page = await request(
            `/api/items?${params.toString()}`,
            itemListOutputSchema,
            "品目を読み込めませんでした",
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
};

/** 履歴は cursor ページングで、1 ページごとにロット内訳を同梱して返る。 */
export const listStockHistory = (
    query: HistoryQuery,
): Promise<StockHistoryResult> =>
    request(
        `/api/inventory/history?${toHistoryParams(query)}`,
        stockHistoryResultSchema,
        "在庫履歴を読み込めませんでした",
    );
