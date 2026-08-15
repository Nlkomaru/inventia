import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { healthSchema } from "../../domain/health";
import { getHealth } from "../../services/healthService";
import type { ApiBindings } from "../bindings";

export const healthApp = new OpenAPIHono<ApiBindings>();
const healthOpenApiSchema = healthSchema.openapi("Health");

const healthRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["System"],
    summary: "Get API health",
    operationId: "getHealth",
    responses: {
        200: {
            description: "The API is healthy",
            content: {
                "application/json": {
                    schema: healthOpenApiSchema,
                },
            },
        },
    },
});

healthApp.openapi(healthRoute, (c) => c.json(getHealth(), 200));
