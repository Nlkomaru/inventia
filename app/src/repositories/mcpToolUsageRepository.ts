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
