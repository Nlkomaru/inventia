import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import {
    type ReceiptApplyInput,
    type ReceiptApplyResult,
    type ReceiptDetailDto,
    type ReceiptDto,
    type ReceiptListDto,
    receiptApplyInputSchema,
    receiptApplyResultSchema,
    receiptDetailDtoSchema,
    receiptDtoSchema,
    receiptStatusSchema,
} from "@/domain/receipt";

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
    init: RequestInit,
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

// 読み取りは server function から service を直接呼ぶ。SSR から自分の公開 URL を
// fetch すると Cloudflare Access に阻まれるため、HTTP API 経由にしない。
// `cloudflare:workers` と service はクライアントバンドルへ漏らさないよう動的 import する。

const receiptListInputSchema = z.object({
    status: receiptStatusSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100),
});

export type ReceiptListInput = z.infer<typeof receiptListInputSchema>;

export const listReceiptsPage = createServerFn({ method: "GET" })
    .validator(receiptListInputSchema)
    .handler(async ({ data }): Promise<ReceiptListDto> => {
        const [{ env }, { listReceipts }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/receiptService"),
        ]);
        return listReceipts(env.DB, data);
    });

/** 明細と照合候補を含むレシート詳細。候補は読み取り時に計算される。 */
export const getReceiptDetail = createServerFn({ method: "GET" })
    .validator(z.object({ receiptId: z.string().trim().min(1) }))
    .handler(async ({ data }): Promise<ReceiptDetailDto> => {
        const [{ env }, { getReceipt }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/receiptService"),
        ]);
        return getReceipt(env.DB, data.receiptId);
    });

export const listAllItems = createServerFn({ method: "GET" }).handler(
    async (): Promise<ItemDto[]> => {
        const [{ env }, { listItems }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/itemService"),
        ]);
        const items: ItemDto[] = [];
        let cursor: string | undefined;
        do {
            const page = await listItems(env.DB, {
                limit: 100,
                ...(cursor === undefined ? {} : { cursor }),
            });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return items;
    },
);

// 新規品目の選択肢はツリー全体を 1 query で取る。categoryTreeMaxSize を超える分は
// 選択肢に出ないため、その場合はカテゴリマスタで整理してから取り込む
export const listCategoryTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<CategoryDto[]> => {
        const [{ env }, { listCategoryTree: fetchCategoryTree }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/categoryService"),
            ]);
        const tree = await fetchCategoryTree(env.DB);
        return tree.items;
    },
);

export const listLocationTree = createServerFn({ method: "GET" }).handler(
    async (): Promise<LocationDto[]> => {
        const [{ env }, { listLocations }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/locationService"),
        ]);
        const result: LocationDto[] = [];
        const listLevel = async (parentId: string | null) => {
            let cursor: string | undefined;
            do {
                const page = await listLocations(env.DB, {
                    parentId,
                    limit: 100,
                    ...(cursor === undefined ? {} : { cursor }),
                });
                result.push(...page.items);
                cursor = page.nextCursor ?? undefined;
            } while (cursor);
        };
        const visit = async (parentId: string | null) => {
            const start = result.length;
            await listLevel(parentId);
            for (const child of result.slice(start)) await visit(child.id);
        };
        await visit(null);
        return result;
    },
);

// 更新系はブラウザから HTTP API を呼ぶ（Access の cookie が付く経路）。
// content-type はブラウザに boundary 付きで決めさせるため、multipart では指定しない。
export const uploadReceiptImage = (file: File): Promise<ReceiptDto> => {
    const body = new FormData();
    body.append("file", file);
    return request(
        "/api/receipts",
        receiptDtoSchema,
        "レシート画像をアップロードできませんでした",
        { method: "POST", body },
    );
};

/**
 * AI 解析と商品照合を実行する。解析に失敗した場合も HTTP は成功し、
 * status = 'failed' と errorMessage を持つ詳細が返る。
 */
export const parseReceipt = (receiptId: string): Promise<ReceiptDetailDto> =>
    request(
        `/api/receipts/${encodeURIComponent(receiptId)}/parse`,
        receiptDetailDtoSchema,
        "レシートを解析できませんでした",
        { method: "POST" },
    );

export const applyReceipt = (
    receiptId: string,
    input: ReceiptApplyInput,
): Promise<ReceiptApplyResult> =>
    request(
        `/api/receipts/${encodeURIComponent(receiptId)}/apply`,
        receiptApplyResultSchema,
        "レシートの内容を反映できませんでした",
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(receiptApplyInputSchema.parse(input)),
        },
    );

/** 反映を開始したレシートは service 側で拒否される（在庫の根拠を残すため）。 */
export const deleteReceipt = (receiptId: string): Promise<{ deleted: true }> =>
    request(
        `/api/receipts/${encodeURIComponent(receiptId)}`,
        z.object({ deleted: z.literal(true) }),
        "レシートを削除できませんでした",
        { method: "DELETE" },
    );
