import { createServerFn } from "@tanstack/react-start";
import type {
    ExternalProviderCreateInput,
    ExternalProviderDto,
    ExternalProviderUpdateInput,
} from "@/domain/externalProvider";

type ApiError = { error?: { message?: string } };

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.error?.message ?? "連携先の更新に失敗しました");
    }
    return (await response.json()) as T;
};

// Cloudflare Access が公開 URL に掛かるため、読み取りは server function から
// service を直接呼ぶ。連携先は件数が限られるマスタで cursor を持たないため、
// 一覧はそのまま全件を返し、絞り込みは画面側で行う。
export const listProviders = createServerFn({ method: "GET" }).handler(
    async (): Promise<ExternalProviderDto[]> => {
        const [{ env }, { listExternalProviders }] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/externalProviderService"),
        ]);
        return (await listExternalProviders(env.DB)).providers;
    },
);

export const createProvider = (input: ExternalProviderCreateInput) =>
    request<ExternalProviderDto>("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

export const updateProvider = (
    id: string,
    input: ExternalProviderUpdateInput,
) =>
    request<ExternalProviderDto>(`/api/providers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });

/** 在庫履歴から参照されている連携先は service 側で拒否される（409）。 */
export const deleteProvider = (id: string) =>
    request<{ deleted: true }>(`/api/providers/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
