import { StreamableHTTPTransport } from "@hono/mcp";
import type { Context } from "hono";
import { z } from "zod";
import { recordMcpToolCall } from "../../repositories/mcpToolUsageRepository";
import type { ApiBindings } from "../bindings";
import { createMcpServer } from "./server";

const mcpToolCallEnvelopeSchema = z
    .object({
        method: z.literal("tools/call"),
        params: z.object({ name: z.string().min(1) }).passthrough(),
    })
    .passthrough();

/**
 * tools/call は 1 request に複数含められるため配列も展開する。MCP protocol の
 * method と params.name が揃う行だけを記録し、initialize 等は監査対象にしない。
 */
const toolCallNames = (body: unknown): string[] => {
    const messages = Array.isArray(body) ? body : [body];
    return messages.flatMap((message) => {
        const parsed = mcpToolCallEnvelopeSchema.safeParse(message);
        return parsed.success ? [parsed.data.params.name] : [];
    });
};

export const handleMcpRequest = async (c: Context<ApiBindings>) => {
    // transport が body を消費する前に clone を読み、MCP tool id と受信時刻だけを
    // 正規化テーブルへ追記する。ログ保存失敗は tool を実行せず返し、未記録の
    // 副作用を作らない。
    const body = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
    const calledAt = new Date().toISOString();
    await Promise.all(
        toolCallNames(body).map((toolName) =>
            recordMcpToolCall(c.env.DB, toolName, calledAt),
        ),
    );

    const server = createMcpServer(c.env);
    const transport = new StreamableHTTPTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    await server.connect(transport);
    return transport.handleRequest(c);
};
