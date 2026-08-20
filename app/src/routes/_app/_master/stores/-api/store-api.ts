import { createServerFn } from "@tanstack/react-start";
import type {
    StoreCreateInput,
    StoreDto,
    StoreUpdateInput,
} from "@/domain/store";

type StoreListResponse = { items: StoreDto[]; nextCursor: string | null };
type ApiError = { error?: { message?: string } };

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? "店舗の更新に失敗しました");
    }
    return (await response.json()) as T;
};

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
            const page: StoreListResponse = await listStores(env.DB, {
                limit: 100,
                cursor,
            });
            stores.push(...page.items);
            cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return stores;
    },
);

export const createStore = (input: StoreCreateInput) =>
    request<StoreDto>("/api/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const updateStore = (id: string, input: StoreUpdateInput) =>
    request<StoreDto>(`/api/stores/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

/** 価格記録から参照されている店舗は service 側で拒否される（409）。 */
export const deleteStore = (id: string) =>
    request<{ deleted: true }>(`/api/stores/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });

// content-type はブラウザに boundary 付きで決めさせるため、multipart では指定しない。
export const uploadStoreFavicon = (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<StoreDto>(`/api/stores/${encodeURIComponent(id)}/favicon`, {
        method: "PUT",
        body,
    });
};

export const deleteStoreFavicon = (id: string) =>
    request<StoreDto>(`/api/stores/${encodeURIComponent(id)}/favicon`, {
        method: "DELETE",
    });
