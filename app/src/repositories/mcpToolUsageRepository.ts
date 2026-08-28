import { newId } from "../domain/id";

/** MCP `tools/call` を正規化して記録する。利用行に tool 名を重複保存しない。 */
export const recordMcpToolCall = async (
    db: D1Database,
    toolName: string,
    calledAt: string = new Date().toISOString(),
): Promise<void> => {
    const tool = await db
        .prepare(
            `INSERT INTO mcp_tools (id, name, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET name = excluded.name
             RETURNING id`,
        )
        .bind(newId(), toolName, calledAt)
        .first<{ id: string }>();
    if (!tool) {
        throw new Error("MCP tool usage could not resolve its tool id");
    }
    await db
        .prepare(
            "INSERT INTO mcp_tool_calls (id, mcp_tool_id, called_at) VALUES (?, ?, ?)",
        )
        .bind(newId(), tool.id, calledAt)
        .run();
};

export interface McpToolCallRow {
    id: string;
    toolId: string;
    calledAt: string;
}

/** テストと運用調査用。呼び出し行は tool id と時刻だけを返す。 */
export const listMcpToolCalls = async (
    db: D1Database,
    toolName: string,
): Promise<McpToolCallRow[]> =>
    (
        await db
            .prepare(
                `SELECT c.id, c.mcp_tool_id AS toolId, c.called_at AS calledAt
                 FROM mcp_tool_calls c
                 INNER JOIN mcp_tools t ON t.id = c.mcp_tool_id
                 WHERE t.name = ?
                 ORDER BY c.called_at ASC, c.id ASC`,
            )
            .bind(toolName)
            .all<McpToolCallRow>()
    ).results;

export interface McpUsageToolRow {
    toolId: string;
    name: string;
    callCount: number;
    lastCalledAt: string;
}

export interface McpUsageRecentCallRow {
    id: string;
    toolId: string;
    toolName: string;
    calledAt: string;
}

export interface McpUsageActivityRow {
    date: string;
    callCount: number;
}

export interface McpUsageSnapshot {
    totalCalls: number;
    tools: McpUsageToolRow[];
    recentCalls: McpUsageRecentCallRow[];
    activity: McpUsageActivityRow[];
}

/** 利用量画面用に、名称を正規化した集計結果を取得する。 */
export const getMcpUsageSnapshot = async (
    db: D1Database,
    activityStart: string,
    activityEnd: string,
    recentLimit: number,
): Promise<McpUsageSnapshot> => {
    const [total, tools, recentCalls, activity] = await Promise.all([
        db
            .prepare("SELECT COUNT(*) AS totalCalls FROM mcp_tool_calls")
            .first<{ totalCalls: number }>(),
        db
            .prepare(
                `SELECT t.id AS toolId, t.name,
                        COUNT(c.id) AS callCount,
                        MAX(c.called_at) AS lastCalledAt
                 FROM mcp_tools t
                 INNER JOIN mcp_tool_calls c ON c.mcp_tool_id = t.id
                 GROUP BY t.id, t.name
                 ORDER BY callCount DESC, t.name ASC, t.id ASC`,
            )
            .all<McpUsageToolRow>(),
        db
            .prepare(
                `SELECT c.id, c.mcp_tool_id AS toolId, t.name AS toolName,
                        c.called_at AS calledAt
                 FROM mcp_tool_calls c
                 INNER JOIN mcp_tools t ON t.id = c.mcp_tool_id
                 ORDER BY c.called_at DESC, c.id DESC
                 LIMIT ?`,
            )
            .bind(recentLimit)
            .all<McpUsageRecentCallRow>(),
        db
            .prepare(
                `SELECT substr(c.called_at, 1, 10) AS date,
                        COUNT(c.id) AS callCount
                 FROM mcp_tool_calls c
                 WHERE c.called_at >= ? AND c.called_at < ?
                 GROUP BY substr(c.called_at, 1, 10)
                 ORDER BY date ASC`,
            )
            .bind(activityStart, activityEnd)
            .all<McpUsageActivityRow>(),
    ]);
    if (!total) {
        throw new Error("MCP usage total could not be read");
    }
    return {
        totalCalls: total.totalCalls,
        tools: tools.results,
        recentCalls: recentCalls.results,
        activity: activity.results,
    };
};
