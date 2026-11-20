import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
    type PriceResearchListOutput,
    type PriceResearchRequestDto,
    priceResearchCompleteSchema,
    priceResearchCreateSchema,
    priceResearchListQuerySchema,
    priceResearchRequestIdSchema,
} from "@/domain/priceResearch";

export const listPriceResearchRequests = createServerFn({ method: "GET" })
    .validator(priceResearchListQuerySchema)
    .handler(async ({ data }): Promise<PriceResearchListOutput> => {
        const [{ env }, { listPriceResearchRequests: listRequests }] =
            await Promise.all([
                import("cloudflare:workers"),
                import("@/services/priceResearchService"),
            ]);
        return listRequests(env, data);
    });

export const createPriceResearchRequestFn = createServerFn({ method: "POST" })
    .validator(priceResearchCreateSchema)
    .handler(async ({ data }): Promise<PriceResearchRequestDto> => {
        const [
            { env },
            { createPriceResearchRequest, PriceResearchServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/priceResearchService"),
        ]);
        try {
            return await createPriceResearchRequest(env, data);
        } catch (error) {
            if (error instanceof PriceResearchServiceError) {
                throw new Error(error.message);
            }
            throw new Error("価格調査依頼の作成に失敗しました");
        }
    });

export const completePriceResearchRequestFn = createServerFn({
    method: "POST",
})
    .validator(
        z.object({
            id: priceResearchRequestIdSchema,
            input: priceResearchCompleteSchema,
        }),
    )
    .handler(async ({ data }): Promise<PriceResearchRequestDto> => {
        const [
            { env },
            { completePriceResearchRequest, PriceResearchServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/priceResearchService"),
        ]);
        try {
            return await completePriceResearchRequest(env, data.id, data.input);
        } catch (error) {
            if (error instanceof PriceResearchServiceError) {
                throw new Error(error.message);
            }
            throw new Error("価格の登録と調査依頼の完了に失敗しました");
        }
    });

export const cancelPriceResearchRequestFn = createServerFn({ method: "POST" })
    .validator(priceResearchRequestIdSchema)
    .handler(async ({ data }): Promise<PriceResearchRequestDto> => {
        const [
            { env },
            { cancelPriceResearchRequest, PriceResearchServiceError },
        ] = await Promise.all([
            import("cloudflare:workers"),
            import("@/services/priceResearchService"),
        ]);
        try {
            return await cancelPriceResearchRequest(env, data);
        } catch (error) {
            if (error instanceof PriceResearchServiceError) {
                throw new Error(error.message);
            }
            throw new Error("価格調査依頼のキャンセルに失敗しました");
        }
    });
