import { StreamableHTTPTransport } from "@hono/mcp";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Scalar } from "@scalar/hono-api-reference";

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

const createMcpServer = () => {
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

	return server;
};

export const apiApp = new OpenAPIHono();

apiApp.openapi(healthRoute, (c) => c.json(getHealth(), 200));

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
	const server = createMcpServer();
	const transport = new StreamableHTTPTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	await server.connect(transport);
	return transport.handleRequest(c);
});

export default apiApp;
