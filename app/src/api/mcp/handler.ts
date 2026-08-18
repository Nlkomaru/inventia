import { StreamableHTTPTransport } from "@hono/mcp";
import type { Context } from "hono";
import type { ApiBindings } from "../bindings";
import { createMcpServer } from "./server";

export const handleMcpRequest = async (c: Context<ApiBindings>) => {
    const server = createMcpServer(c.env);
    const transport = new StreamableHTTPTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    await server.connect(transport);
    return transport.handleRequest(c);
};
