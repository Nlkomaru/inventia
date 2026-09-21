import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
    type StoreCreateInput,
    type StoreDto,
    type StoreUpdateInput,
    storeCreateInputSchema,
    storeIdSchema,
    storeUpdateInputSchema,
} from "@/domain/store";

type StoreListResponse = { items: StoreDto[]; nextCursor: string | null };

// Cloudflare Access が公開 URL に掛かるため、読み取りは server function から
// service を直接呼ぶ。件数が少ないマスタなので全件をまとめて取得し、
// 絞り込みは画面側で行う。
export const listAllStores = createServerFn({ method: "GET" }).handler(
    async (): Promise<StoreDto[]> => {
        const [{ env }, { listStores }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/storeService"),
        ]);
        const stores: StoreDto[] = [];
        let cursor: string | undefined;
        do {
            const page: StoreListResponse = await listStores(env, {
                limit: 100,
                cursor,
            });
            stores.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return stores;
    },
);

const createStoreServerFn = createServerFn({ method: "POST" })
    .validator(storeCreateInputSchema)
    .handler(async ({ data }): Promise<StoreDto> => {
        const [{ env }, { createStore, StoreServiceError }] = await Promise.all(
            [import("cloudflare:workers"), import("@/services/storeService")],
        );
        try {
            return await createStore(env, data);
        } catch (error) {
            if (error instanceof StoreServiceError) {
                throw new Error(error.message);
            }
            throw new Error("店舗の更新に失敗しました");
        }
    });

const updateStoreServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            id: storeIdSchema,
            input: storeUpdateInputSchema,
        }),
    )
    .handler(async ({ data }): Promise<StoreDto> => {
        const [{ env }, { updateStore, StoreServiceError }] = await Promise.all(
            [import("cloudflare:workers"), import("@/services/storeService")],
        );
        try {
            return await updateStore(env, data.id, data.input);
        } catch (error) {
            if (error instanceof StoreServiceError) {
                throw new Error(error.message);
            }
            throw new Error("店舗の更新に失敗しました");
        }
    });

const deleteStoreServerFn = createServerFn({ method: "POST" })
    .validator(storeIdSchema)
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [{ env }, { deleteStore, StoreServiceError }] = await Promise.all(
            [import("cloudflare:workers"), import("@/services/storeService")],
        );
        try {
            await deleteStore(env, data);
            return { deleted: true };
        } catch (error) {
            if (error instanceof StoreServiceError) {
                throw new Error(error.message);
            }
            throw new Error("店舗の更新に失敗しました");
        }
    });

const uploadStoreFaviconServerFn = createServerFn({ method: "POST" })
    .validator((data: FormData) => data)
    .handler(async ({ data }): Promise<StoreDto> => {
        const id = data.get("id");
        const file = data.get("file");
        if (!(file instanceof File)) {
            throw new Error("ファビコン画像を file パートに添付してください。");
        }
        const [{ env }, { uploadStoreFavicon, StoreServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/storeService"),
            ]);
        try {
            return await uploadStoreFavicon(env, id, {
                bytes: await file.arrayBuffer(),
                contentType: file.type,
            });
        } catch (error) {
            if (error instanceof StoreServiceError) {
                throw new Error(error.message);
            }
            throw new Error("店舗の更新に失敗しました");
        }
    });

const deleteStoreFaviconServerFn = createServerFn({ method: "POST" })
    .validator(storeIdSchema)
    .handler(async ({ data }): Promise<StoreDto> => {
        const [{ env }, { deleteStoreFavicon, StoreServiceError }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/storeService"),
            ]);
        try {
            return await deleteStoreFavicon(env, data);
        } catch (error) {
            if (error instanceof StoreServiceError) {
                throw new Error(error.message);
            }
            throw new Error("店舗の更新に失敗しました");
        }
    });

export const createStore = (input: StoreCreateInput): Promise<StoreDto> =>
    createStoreServerFn({ data: input });

export const updateStore = (
    id: string,
    input: StoreUpdateInput,
): Promise<StoreDto> => updateStoreServerFn({ data: { id, input } });

/** 価格記録から参照されている店舗は service 側で拒否される。 */
export const deleteStore = (id: string): Promise<{ deleted: true }> =>
    deleteStoreServerFn({ data: id });

export const uploadStoreFavicon = (
    id: string,
    file: File,
): Promise<StoreDto> => {
    const data = new FormData();
    data.append("id", id);
    data.append("file", file);
    return uploadStoreFaviconServerFn({ data });
};

export const deleteStoreFavicon = (id: string): Promise<StoreDto> =>
    deleteStoreFaviconServerFn({ data: id });
