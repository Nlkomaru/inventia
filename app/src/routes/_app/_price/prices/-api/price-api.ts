import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AllPriceRecordDto } from "@/domain/price";

// 読み取りは server function から service を直接呼ぶ。SSR から自分の公開 URL を
// fetch すると Cloudflare Access に阻まれるため、HTTP API 経由にしない。
// `cloudflare:workers` と service はクライアントバンドルへ漏らさないよう動的 import する。

/** 未指定の cursor は「キーごと省略」で表す（service 側の schema は strict）。 */
const priceRecordListInputSchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100),
});

export const listAllPriceRecords = createServerFn({ method: "GET" })
    .validator(priceRecordListInputSchema)
    .handler(
        async ({
            data,
        }): Promise<{
            items: AllPriceRecordDto[];
            nextCursor: string | null;
        }> => {
            const [{ env }, { listAllPriceRecords: listRecords }] =
                await Promise.all([
                    import("cloudflare:workers"),
                    import("@/services/priceService"),
                ]);
            return listRecords(env.DB, data);
        },
    );
