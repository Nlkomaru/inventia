import {
    type McpUsageSummary,
    mcpUsageActivitySchema,
    mcpUsagePeriodDays,
    mcpUsageRecentCallLimit,
    mcpUsageSummarySchema,
} from "../domain/usage";
import {
    getMcpUsageSnapshot,
    type McpUsageSnapshot,
} from "../repositories/mcpToolUsageRepository";

export class McpUsageServiceError extends Error {
    readonly code = "MCP_USAGE_INVALID_DATA" as const;
    readonly status = 500 as const;

    constructor(message = "MCP 利用量のデータを読み取れませんでした。") {
        super(message);
        this.name = "McpUsageServiceError";
    }
}

const utcDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const addUtcDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
};

const toUtcStart = (dateKey: string): string => `${dateKey}T00:00:00.000Z`;

const isValidDate = (value: string): boolean =>
    !Number.isNaN(new Date(value).getTime());

const snapshotSchema = mcpUsageSummarySchema
    .omit({ periodDays: true, activity: true })
    .extend({
        activity: mcpUsageSummarySchema.shape.activity,
    });

const parseSnapshot = (snapshot: McpUsageSnapshot) => {
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
        throw new McpUsageServiceError();
    }
    if (
        parsed.data.tools.some((tool) => !isValidDate(tool.lastCalledAt)) ||
        parsed.data.recentCalls.some((call) => !isValidDate(call.calledAt)) ||
        parsed.data.activity.some(
            (row) => !mcpUsageActivitySchema.safeParse(row).success,
        )
    ) {
        throw new McpUsageServiceError();
    }
    return parsed.data;
};

/** MCP 利用記録を、総計・tool別・直近履歴・UTC日別へ整形する。 */
export const getMcpUsage = async (
    db: D1Database,
    now: Date = new Date(),
): Promise<McpUsageSummary> => {
    if (Number.isNaN(now.getTime())) {
        throw new McpUsageServiceError();
    }
    const today = utcDateKey(now);
    const todayStart = new Date(toUtcStart(today));
    const activityStartDate = addUtcDays(todayStart, -(mcpUsagePeriodDays - 1));
    const activityEndDate = addUtcDays(todayStart, 1);
    const snapshot = parseSnapshot(
        await getMcpUsageSnapshot(
            db,
            toUtcStart(utcDateKey(activityStartDate)),
            toUtcStart(utcDateKey(activityEndDate)),
            mcpUsageRecentCallLimit,
        ),
    );
    const activityByDate: Record<string, number> = {};
    for (const row of snapshot.activity) {
        activityByDate[row.date] = row.callCount;
    }
    const activity = Array.from({ length: mcpUsagePeriodDays }, (_, index) => {
        const date = utcDateKey(addUtcDays(activityStartDate, index));
        return { date, callCount: activityByDate[date] ?? 0 };
    });
    return mcpUsageSummarySchema.parse({
        periodDays: mcpUsagePeriodDays,
        totalCalls: snapshot.totalCalls,
        tools: snapshot.tools,
        recentCalls: snapshot.recentCalls,
        activity,
    });
};
