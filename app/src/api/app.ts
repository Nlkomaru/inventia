import { StreamableHTTPTransport } from "@hono/mcp";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Scalar } from "@scalar/hono-api-reference";
import { itemDtoSchema, itemListQuerySchema } from "../domain/item";
import { getItem, ItemServiceError, listItems } from "../services/itemService";
import { itemsApp } from "./items";
import { locationsApp } from "./locations";

const HealthSchema = z
    .object({
        status: z.literal("ok").openapi({
            description: "Current service status",
            example: "ok",
        }),
        service: z.literal("inventia-api").openapi({
            description: "Service identifier",
            example: "inventia-api",
        }),
        deployedAt: z.string().datetime().nullable().openapi({
            description: "UTC time embedded in the deployment build",
            example: "2026-08-11T00:00:00.000Z",
        }),
        checkedAt: z.string().datetime().openapi({
            description: "UTC time when the health check was performed",
            example: "2026-08-07T00:00:00.000Z",
        }),
    })
    .openapi("Health");

const ItemSearchOutputSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});

type Health = z.infer<typeof HealthSchema>;

const getHealth = (): Health => ({
    status: "ok",
    service: "inventia-api",
    deployedAt: import.meta.env.VITE_DEPLOYED_AT || null,
    checkedAt: new Date().toISOString(),
});

const healthRoute = createRoute({
    method: "get",
    path: "/api/health",
    tags: ["System"],
    summary: "Get API health",
    operationId: "getHealth",
    responses: {
        200: {
            description: "The API is healthy",
            content: {
                "application/json": {
                    schema: HealthSchema,
                },
            },
        },
    },
});

const createMcpServer = (db: D1Database) => {
    const server = new McpServer({
        name: "inventia-api",
        version: "1.0.0",
    });

    server.registerTool(
        "get_health",
        {
            title: "Get API health",
            description:
                "Get the current health status, deployment time, and check time for the Inventia API.",
            inputSchema: z.object({}),
            outputSchema: HealthSchema,
        },
        async () => {
            const health = getHealth();

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(health),
                    },
                ],
                structuredContent: health,
            };
        },
    );

    server.registerTool(
        "search_inventory",
        {
            title: "Search inventory",
            description:
                "Search inventory item names and filter by category, storage location, or low-stock state. Results are cursor-paginated and limited to 100 items.",
            inputSchema: itemListQuerySchema,
            outputSchema: ItemSearchOutputSchema,
        },
        async (input) => {
            try {
                const result = await listItems(db, input);
                return {
                    content: [{ type: "text", text: JSON.stringify(result) }],
                    structuredContent: result,
                };
            } catch (error) {
                const message =
                    error instanceof ItemServiceError
                        ? `${error.code}: ${error.message}`
                        : "INTERNAL_ERROR: inventory search failed";
                return {
                    isError: true,
                    content: [{ type: "text", text: message }],
                };
            }
        },
    );

    server.registerTool(
        "get_inventory_item",
        {
            title: "Get inventory item",
            description:
                "Get one inventory item by its system ID, including its base unit, current quantity, expiry date, and low-stock threshold.",
            inputSchema: z.object({ id: z.string().min(1) }),
            outputSchema: itemDtoSchema,
        },
        async ({ id }) => {
            try {
                const item = await getItem(db, id);
                return {
                    content: [{ type: "text", text: JSON.stringify(item) }],
                    structuredContent: item,
                };
            } catch (error) {
                const message =
                    error instanceof ItemServiceError
                        ? `${error.code}: ${error.message}`
                        : "INTERNAL_ERROR: inventory item lookup failed";
                return {
                    isError: true,
                    content: [{ type: "text", text: message }],
                };
            }
        },
    );

    return server;
};

export const apiApp = new OpenAPIHono<{
    Bindings: { DB: D1Database };
}>();

apiApp.openapi(healthRoute, (c) => c.json(getHealth(), 200));

apiApp.route("/api/locations", locationsApp);
apiApp.route("/api/items", itemsApp);

apiApp.doc31("/api/openapi", {
    openapi: "3.1.0",
    info: {
        title: "Inventia API",
        version: "1.0.0",
        description: "HTTP API and health surface for Inventia.",
    },
});

apiApp.get(
    "/api/scalar",
    Scalar({
        url: "/api/openapi",
    }),
);

apiApp.all("/api/mcp", async (c) => {
    const server = createMcpServer(c.env.DB);
    const transport = new StreamableHTTPTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });

    await server.connect(transport);
    return transport.handleRequest(c);
});

export default apiApp;
