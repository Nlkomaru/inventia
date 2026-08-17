import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
    openRouterChatModelListSchema,
    openRouterIntegrationStatusSchema,
    openRouterIntegrationUpdateSchema,
} from "../../domain/integration";
import {
    getOpenRouterIntegrationStatus,
    IntegrationServiceError,
    listOpenRouterVisionModels,
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
    description:
        "Returns the embedding model, the selected multimodal chat model and whether the API key is stored. `chatModel` falls back to the built-in default while `chatModelConfigured` is false. The API key is never returned.",
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

const listOpenRouterModelsRoute = createRoute({
    method: "get",
    path: "/openrouter/models",
    tags: ["Integrations"],
    summary: "List selectable OpenRouter multimodal models",
    operationId: "listOpenRouterVisionModels",
    description:
        "Lists the image-capable models published by OpenRouter so that a client can offer them as choices for `chatModel`. The stored API key is used only to authenticate the upstream request and is never returned.",
    responses: {
        200: {
            description: "The image-capable models offered by OpenRouter.",
            content: jsonContent(openRouterChatModelListSchema),
        },
        502: {
            description:
                "OpenRouter could not be reached or returned an unexpected response. Retry later; the currently stored model stays usable.",
            content: jsonContent(errorSchema),
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
    description:
        "Stores the API key and the multimodal chat model. Both fields are optional and at least one is required, so the chat model can be saved without entering an API key. The API key is encrypted server-side and never returned or logged. The embedding model is fixed and cannot be changed.",
    request: {
        body: {
            required: true,
            content: jsonContent(openRouterIntegrationUpdateSchema),
        },
    },
    responses: {
        200: {
            description: "The submitted settings were stored successfully.",
            content: jsonContent(openRouterIntegrationStatusSchema),
        },
        400: {
            description:
                "The API key or the model id is invalid, or neither field was provided.",
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

integrationsApp.openapi(listOpenRouterModelsRoute, async (c) => {
    try {
        return c.json(
            await listOpenRouterVisionModels(
                c.env.DB,
                c.env.SETTINGS_ENCRYPTION_KEY,
            ),
            200,
        );
    } catch (error) {
        if (error instanceof IntegrationServiceError && error.status === 502) {
            return c.json(
                { error: { code: error.code, message: error.message } },
                502,
            );
        }
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
            if (error.status === 400) {
                return c.json(body, 400);
            }
            if (error.status === 503) {
                return c.json(body, 503);
            }
        }
        return c.json(internalError, 500);
    }
});
