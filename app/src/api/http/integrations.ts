import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
    openRouterIntegrationStatusSchema,
    openRouterIntegrationUpdateSchema,
} from "../../domain/integration";
import {
    getOpenRouterIntegrationStatus,
    IntegrationServiceError,
    updateOpenRouterIntegration,
} from "../../services/integrationService";
import type { ApiBindings } from "../bindings";

export const integrationsApp = new OpenAPIHono<ApiBindings>();

const errorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const jsonContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

const getOpenRouterRoute = createRoute({
    method: "get",
    path: "/openrouter",
    tags: ["Integrations"],
    summary: "Get OpenRouter integration status",
    operationId: "getOpenRouterIntegrationStatus",
    responses: {
        200: {
            description:
                "The OpenRouter integration status. The API key is never returned.",
            content: jsonContent(openRouterIntegrationStatusSchema),
        },
        500: {
            description: "The service could not complete the request.",
            content: jsonContent(errorSchema),
        },
    },
});

const updateOpenRouterRoute = createRoute({
    method: "put",
    path: "/openrouter",
    tags: ["Integrations"],
    summary: "Configure the OpenRouter integration",
    operationId: "updateOpenRouterIntegration",
    request: {
        body: {
            required: true,
            content: jsonContent(openRouterIntegrationUpdateSchema),
        },
    },
    responses: {
        200: {
            description: "The encrypted API key was stored successfully.",
            content: jsonContent(openRouterIntegrationStatusSchema),
        },
        400: {
            description: "The API key is invalid.",
            content: jsonContent(errorSchema),
        },
        503: {
            description: "Server-side settings encryption is not configured.",
            content: jsonContent(errorSchema),
        },
        500: {
            description: "The service could not complete the request.",
            content: jsonContent(errorSchema),
        },
    },
});

const internalError = {
    error: {
        code: "INTERNAL_ERROR",
        message: "内部エラーが発生しました。",
    },
};

integrationsApp.openapi(getOpenRouterRoute, async (c) => {
    try {
        return c.json(await getOpenRouterIntegrationStatus(c.env.DB), 200);
    } catch {
        return c.json(internalError, 500);
    }
});

integrationsApp.openapi(updateOpenRouterRoute, async (c) => {
    try {
        return c.json(
            await updateOpenRouterIntegration(
                c.env.DB,
                c.env.SETTINGS_ENCRYPTION_KEY,
                c.req.valid("json"),
            ),
            200,
        );
    } catch (error) {
        if (error instanceof IntegrationServiceError) {
            const body = {
                error: { code: error.code, message: error.message },
            };
            return error.status === 400 ? c.json(body, 400) : c.json(body, 503);
        }
        return c.json(internalError, 500);
    }
});
