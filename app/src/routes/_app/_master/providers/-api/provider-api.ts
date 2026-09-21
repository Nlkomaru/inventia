import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
    type ExternalProviderCreateInput,
    type ExternalProviderDto,
    type ExternalProviderUpdateInput,
    externalProviderCreateInputSchema,
    externalProviderIdSchema,
    externalProviderUpdateInputSchema,
} from "@/domain/externalProvider";

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

// 更新も読み取りと同じ server function 境界から service を直接呼ぶ。
// 画面は API トークンを持たず、/api の HTTP 経路を通らない。
const createProviderServerFn = createServerFn({ method: "POST" })
    .validator(externalProviderCreateInputSchema)
    .handler(async ({ data }): Promise<ExternalProviderDto> => {
        const [
            { env },
            { createExternalProvider: create, ExternalProviderServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/externalProviderService"),
        ]);
        try {
            return await create(env.DB, data);
        } catch (error) {
            if (error instanceof ExternalProviderServiceError) {
                throw new Error(error.message);
            }
            throw new Error("連携先の更新に失敗しました");
        }
    });

const updateProviderServerFn = createServerFn({ method: "POST" })
    .validator(
        z.object({
            id: externalProviderIdSchema,
            input: externalProviderUpdateInputSchema,
        }),
    )
    .handler(async ({ data }): Promise<ExternalProviderDto> => {
        const [
            { env },
            { updateExternalProvider: update, ExternalProviderServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/externalProviderService"),
        ]);
        try {
            return await update(env.DB, data.id, data.input);
        } catch (error) {
            if (error instanceof ExternalProviderServiceError) {
                throw new Error(error.message);
            }
            throw new Error("連携先の更新に失敗しました");
        }
    });

const deleteProviderServerFn = createServerFn({ method: "POST" })
    .validator(externalProviderIdSchema)
    .handler(async ({ data }): Promise<{ deleted: true }> => {
        const [
            { env },
            { deleteExternalProvider, ExternalProviderServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/externalProviderService"),
        ]);
        try {
            await deleteExternalProvider(env.DB, data);
            return { deleted: true };
        } catch (error) {
            if (error instanceof ExternalProviderServiceError) {
                throw new Error(error.message);
            }
            throw new Error("連携先の更新に失敗しました");
        }
    });

export const createProvider = (
    input: ExternalProviderCreateInput,
): Promise<ExternalProviderDto> => createProviderServerFn({ data: input });

export const updateProvider = (
    id: string,
    input: ExternalProviderUpdateInput,
): Promise<ExternalProviderDto> =>
    updateProviderServerFn({ data: { id, input } });

/** 在庫履歴から参照されている連携先は service 側で拒否される（409）。 */
export const deleteProvider = (id: string): Promise<{ deleted: true }> =>
    deleteProviderServerFn({ data: id });
