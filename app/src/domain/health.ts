import { z } from "zod";

export const healthSchema = z.object({
    status: z.literal("ok"),
    service: z.literal("inventia-api"),
    deployedAt: z.string().datetime().nullable(),
    checkedAt: z.string().datetime(),
});

export type Health = z.infer<typeof healthSchema>;
