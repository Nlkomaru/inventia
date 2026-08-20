import { z } from "zod";
import { type ItemDto, itemDtoSchema, itemEmojiSchema } from "@/domain/item";

// 絵文字の書き込みは HTTP API を通す。生成の失敗理由（API key 未設定・上流の不調）は
// API が利用者向けの文言で返すため、server function で包み直さずそのまま見せる。
const apiErrorSchema = z.object({
    error: z
        .object({
            message: z.string().optional(),
        })
        .optional(),
});

const request = async (
    url: string,
    fallbackMessage: string,
    init: RequestInit,
): Promise<ItemDto> => {
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
    return itemDtoSchema.parse(await response.json());
};

/**
 * 絵文字を AI で作り直す。失敗した場合は保存済みの絵文字が残るため、
 * 呼び出し側は文言を見せて再試行か手入力へ促せばよい。
 */
export const regenerateItemEmoji = (itemId: string): Promise<ItemDto> =>
    request(
        `/api/items/${encodeURIComponent(itemId)}/emoji`,
        "絵文字を生成できませんでした",
        { method: "POST" },
    );

/** 絵文字を手で置き換える。品目の更新エンドポイントを使う。 */
export const setItemEmoji = (itemId: string, emoji: string): Promise<ItemDto> =>
    request(
        `/api/items/${encodeURIComponent(itemId)}`,
        "絵文字を保存できませんでした",
        {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ emoji: itemEmojiSchema.parse(emoji) }),
        },
    );
