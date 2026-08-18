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

// zod-openapi の検証は handler より前に走る。既定のままでは ZodError がそのまま
// 応答本文になり、他のエンドポイントと形が揃わないため利用者向けの形へ写す
export const integrationsApp = new OpenAPIHono<ApiBindings>({
    defaultHook: (result, c) => {
        if (result.success) {
            return;
        }
        return c.json(
            {
                error: {
                    code: "INTEGRATION_INVALID_INPUT",
                    message:
                        result.error.issues[0]?.message ??
                        "入力内容を確認してください。",
                },
            },
            400,
        );
    },
});

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
        "Returns the embedding model, the selected multimodal chat model, the instructions used to read receipts and whether the API key is stored. `chatModel` and `receiptPrompt` fall back to the built-in defaults while `chatModelConfigured` and `receiptPromptConfigured` are false, so `receiptPrompt` always holds the text that a parse would actually send. `receiptToolsEnabled` reports whether receipt parsing may call the read-only inventory tools. The API key is never returned.",
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
        "Stores the API key, the multimodal chat model, the receipt reading instructions and whether receipt parsing may call tools. Every field is optional and at least one is required, so any one of them can be saved on its own; the fields that are left out keep their stored values. Send `receiptPrompt` as null to go back to the built-in instructions, which is also what happens when the submitted text is only whitespace or matches the default. Only the API key needs server-side encryption, so the other fields can be saved while `SETTINGS_ENCRYPTION_KEY` is missing. The API key is encrypted server-side and never returned or logged. The embedding model is fixed and cannot be changed.",
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
                "The API key, the model id or the receipt instructions are invalid, or no field was provided.",
            content: jsonContent(errorSchema),
        },
        503: {
            description:
                "Server-side settings encryption is not configured; it is only required when an API key is submitted.",
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
