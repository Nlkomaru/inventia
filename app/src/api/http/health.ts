import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getHealth } from "../../services/healthService";
import type { ApiBindings } from "../bindings";

export const healthApp = new OpenAPIHono<ApiBindings>();
// domain の zod は OpenAPI 拡張を持たないため、Worker bundle では .openapi()
// を呼べない。HTTP 契約用の schema は @hono/zod-openapi で組み立てる。
const healthOpenApiSchema = z
    .object({
        status: z.literal("ok"),
        service: z.literal("inventia-api"),
        deployedAt: z.string().datetime().nullable(),
        checkedAt: z.string().datetime(),
    })
    .openapi("Health");

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
