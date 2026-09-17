import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import {
    type ReceiptApplyResult,
    type ReceiptDetailDto,
    type ReceiptDto,
    type ReceiptListDto,
    receiptApplyInputSchema,
    receiptStatusSchema,
} from "@/domain/receipt";
import type { StoreDto } from "@/domain/store";

const receiptListInputSchema = z.object({
    status: receiptStatusSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100),
});

export type ReceiptListInput = z.infer<typeof receiptListInputSchema>;
const receiptIdInputSchema = z.object({
    receiptId: z.string().trim().min(1),
});

const receiptApplyRequestSchema = z.object({
    receiptId: receiptIdInputSchema.shape.receiptId,
    input: receiptApplyInputSchema,
});

export const listReceiptsPage = createServerFn({ method: "GET" })
    .validator(receiptListInputSchema)
    .handler(async ({ data }): Promise<ReceiptListDto> => {
        const [{ env }, { listReceipts }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/receiptService"),
        ]);
        return listReceipts(env, data);
    });

/** 明細と照合候補を含むレシート詳細。候補は読み取り時に計算される。 */
export const getReceiptDetail = createServerFn({ method: "GET" })
    .validator(z.object({ receiptId: z.string().trim().min(1) }))
    .handler(async ({ data }): Promise<ReceiptDetailDto> => {
        const [{ env }, { getReceipt }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/receiptService"),
        ]);
        return getReceipt(env, data.receiptId);
    });

/**
 * 読み取った店名に対応する登録済みの店舗。反映前にファビコンを見せるための
 * 読み取りで、店舗の作成はしない。見つからなければ null。
 */
export const lookupReceiptStore = createServerFn({ method: "GET" })
    .validator(z.object({ name: z.string().trim().min(1) }))
    .handler(async ({ data }): Promise<StoreDto | null> => {
        const [{ env }, { lookupStoreByName }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/storeService"),
        ]);
        return lookupStoreByName(env, data.name);
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

// /api は API トークン必須のため、レシート取込画面の更新系も server function
// から service を直接呼ぶ。画像だけは FormData のまま送って File を保持する。
export const uploadReceiptImage = createServerFn({ method: "POST" })
    .validator((data: FormData) => data)
    .handler(async ({ data }): Promise<ReceiptDto> => {
        const file = data.get("file");
        if (file === null) {
            throw new Error(
                "レシート画像が送信されていません。file パートに画像を添付してください。",
            );
        }
        if (!(file instanceof File)) {
            throw new Error(
                "file パートがファイルではありません。レシート画像を file パートに添付してください。",
            );
        }
        const [{ env }, { uploadReceipt, ReceiptServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/receiptService"),
            ]);
        try {
            return await uploadReceipt(env, {
                bytes: await file.arrayBuffer(),
                contentType: file.type,
            });
        } catch (error) {
            if (error instanceof ReceiptServiceError) {
                throw new Error(error.message);
            }
            throw new Error("レシート画像をアップロードできませんでした。");
        }
    });

/**
 * AI 解析と商品照合を実行する。解析に失敗した場合も正常応答を返し、
 * status = 'failed' と errorMessage を持つ詳細が返る。
 */
export const parseReceipt = createServerFn({ method: "POST" })
    .validator(receiptIdInputSchema)
    .handler(async ({ data }): Promise<ReceiptDetailDto> => {
        const [
            { env },
            { parseReceipt: parse, ReceiptServiceError },
            { createInProcessMcpToolSet },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/receiptService"),
            import("@/api/mcp/in-process"),
        ]);
        try {
            return await parse(env, data.receiptId, {
                createToolSet: () => createInProcessMcpToolSet(env),
            });
        } catch (error) {
            if (error instanceof ReceiptServiceError) {
                throw new Error(error.message);
            }
            throw new Error("レシートを解析できませんでした。");
        }
    });

export const applyReceipt = createServerFn({ method: "POST" })
    .validator(receiptApplyRequestSchema)
    .handler(async ({ data }): Promise<ReceiptApplyResult> => {
        const [{ env }, { applyReceipt: apply, ReceiptServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/receiptService"),
            ]);
        try {
            return await apply(env.DB, data.receiptId, data.input, env);
        } catch (error) {
            if (error instanceof ReceiptServiceError) {
                throw new Error(error.message);
            }
            throw new Error("レシートの内容を反映できませんでした。");
        }
    });

/** 反映を開始したレシートは service 側で拒否される（在庫の根拠を残すため）。 */
export const deleteReceipt = createServerFn({ method: "POST" })
    .validator(receiptIdInputSchema)
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [{ env }, { deleteReceipt: remove, ReceiptServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/receiptService"),
            ]);
        try {
            await remove(env, data.receiptId);
            return { deleted: true };
        } catch (error) {
            if (error instanceof ReceiptServiceError) {
                throw new Error(error.message);
            }
            throw new Error("レシートを削除できませんでした。");
        }
    });
