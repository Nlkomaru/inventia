import { z } from "zod";

export const mcpUsagePeriodDays = 30 as const;
export const mcpUsageRecentCallLimit = 20 as const;

export const mcpUsageToolSchema = z
    .object({
        toolId: z.string().min(1),
        name: z.string().min(1),
        callCount: z.int().nonnegative(),
        lastCalledAt: z.string().datetime(),
    })
    .strict();

export const mcpUsageRecentCallSchema = z
    .object({
        id: z.string().min(1),
        toolId: z.string().min(1),
        toolName: z.string().min(1),
        calledAt: z.string().datetime(),
    })
    .strict();

export const mcpUsageActivitySchema = z
    .object({
        date: z.iso.date(),
        callCount: z.int().nonnegative(),
    })
    .strict();

export const mcpUsageSummarySchema = z
    .object({
        periodDays: z.literal(mcpUsagePeriodDays),
        totalCalls: z.int().nonnegative(),
        tools: z.array(mcpUsageToolSchema),
        recentCalls: z.array(mcpUsageRecentCallSchema),
        activity: z.array(mcpUsageActivitySchema),
    })
    .strict();

export type McpUsageSummary = z.infer<typeof mcpUsageSummarySchema>;
