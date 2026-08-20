import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    externalProviderCreateInputSchema,
    externalProviderDeleteOutputSchema,
    externalProviderDtoSchema,
    externalProviderListSchema,
    externalProviderUpdateInputSchema,
} from "../../domain/externalProvider";
import {
    createExternalProvider,
    deleteExternalProvider,
    ExternalProviderServiceError,
    getExternalProvider,
    listExternalProviders,
    updateExternalProvider,
} from "../../services/externalProviderService";
import type { ApiBindings } from "../bindings";

type ExternalProvidersContext = Context<ApiBindings>;

export const externalProvidersApp = new OpenAPIHono<ApiBindings>();

const externalProviderErrorSchema = z
    .object({
        error: z
            .object({
                code: z.string(),
                message: z.string(),
            })
            .strict(),
    })
    .strict();

// domain のスキーマから取り出した field へ .openapi() を呼ぶと bundle 後に zod の
// 実体が分かれて実行時 TypeError になるため、パスパラメータはここで組み立てる
const providerIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "providerId", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });

const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(externalProviderErrorSchema),
});

const internalError = jsonError("The service could not complete the request.");

externalProvidersApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["External providers"],
    summary: "List external providers",
    operationId: "listExternalProviders",
    description:
        "Lists external providers ordered by name then by id, up to the first 200. This endpoint only reads data. Providers are a small master list, so there is no cursor and no filter; fetch the list once and match it in the caller. faviconUrl is an external image URL stored as text — no image is uploaded to or served by this API.",
    responses: {
        200: {
            description:
                "External providers ordered by name, at most the first 200.",
            content: responseContent(externalProviderListSchema),
        },
        500: internalError,
    },
});

externalProvidersApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["External providers"],
    summary: "Create an external provider",
    operationId: "createExternalProvider",
    description:
        "Creates one external provider. Side effects: one external provider row is created; no item, stock or price data changes. Names are unique across all providers, so a name that already exists is refused. faviconUrl and url are optional and default to null; both must be http or https URLs because they are only shown back to the caller as a link and an image source.",
    request: {
        body: {
            required: true,
            content: responseContent(externalProviderCreateInputSchema),
        },
    },
    responses: {
        201: {
            description: "The created external provider.",
            content: responseContent(externalProviderDtoSchema),
        },
        400: jsonError(
            "EXTERNAL_PROVIDER_INVALID_INPUT: the body is not valid JSON, the name is empty or longer than 100 characters, or faviconUrl or url is not an http or https URL of 2048 characters or fewer.",
        ),
        409: jsonError(
            "EXTERNAL_PROVIDER_NAME_CONFLICT: another provider already uses this name. Pick a different name or edit the existing provider.",
        ),
        500: internalError,
    },
});

externalProvidersApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{providerId}",
    tags: ["External providers"],
    summary: "Get an external provider",
    operationId: "getExternalProvider",
    description:
        "Returns one external provider by its system id. This endpoint only reads data.",
    request: { params: z.object({ providerId: providerIdParameter }) },
    responses: {
        200: {
            description: "The requested external provider.",
            content: responseContent(externalProviderDtoSchema),
        },
        400: jsonError(
            "EXTERNAL_PROVIDER_INVALID_INPUT: the provider id is empty.",
        ),
        404: jsonError(
            "EXTERNAL_PROVIDER_NOT_FOUND: the provider does not exist.",
        ),
        500: internalError,
    },
});

externalProvidersApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{providerId}",
    tags: ["External providers"],
    summary: "Update an external provider",
    operationId: "updateExternalProvider",
    description:
        "Renames an external provider or changes its faviconUrl or url. Side effects: the provider row is updated; stock movements that already reference it keep pointing at the same provider and their stored external ids are untouched. Only the given fields change and at least one is required; sending faviconUrl or url as null clears it, while omitting a field leaves it unchanged. faviconUrl and url must be http or https URLs.",
    request: {
        params: z.object({ providerId: providerIdParameter }),
        body: {
            required: true,
            content: responseContent(externalProviderUpdateInputSchema),
        },
    },
    responses: {
        200: {
            description: "The updated external provider.",
            content: responseContent(externalProviderDtoSchema),
        },
        400: jsonError(
            "EXTERNAL_PROVIDER_INVALID_INPUT: the body is not valid JSON, contains no field to update, or the name is invalid, or faviconUrl or url is not an http or https URL.",
        ),
        404: jsonError(
            "EXTERNAL_PROVIDER_NOT_FOUND: the provider does not exist.",
        ),
        409: jsonError(
            "EXTERNAL_PROVIDER_NAME_CONFLICT: another provider already uses this name.",
        ),
        500: internalError,
    },
});

externalProvidersApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{providerId}",
    tags: ["External providers"],
    summary: "Delete an external provider",
    operationId: "deleteExternalProvider",
    description:
        "Deletes an external provider that no stock movement refers to. Side effects: the provider row is removed; no stock movement is deleted or rewritten. A provider that stock movements still refer to is refused so their history keeps pointing at a provider that exists; change the provider recorded on those movements first.",
    request: { params: z.object({ providerId: providerIdParameter }) },
    responses: {
        200: {
            description: "The external provider was deleted.",
            content: responseContent(externalProviderDeleteOutputSchema),
        },
        400: jsonError(
            "EXTERNAL_PROVIDER_INVALID_INPUT: the provider id is empty.",
        ),
        404: jsonError(
            "EXTERNAL_PROVIDER_NOT_FOUND: the provider does not exist.",
        ),
        409: jsonError(
            "EXTERNAL_PROVIDER_IN_USE: stock movements still refer to this provider. Change the provider recorded on them before deleting it.",
        ),
        500: internalError,
    },
});

const errorResponse = (
    c: ExternalProvidersContext,
    error: unknown,
): Response => {
    if (error instanceof ExternalProviderServiceError) {
        return c.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            error.status,
        );
    }
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "内部エラーが発生しました。",
            },
        },
        500,
    );
};

const parseJson = async (c: ExternalProvidersContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new ExternalProviderServiceError(
            "EXTERNAL_PROVIDER_INVALID_INPUT",
            "リクエスト本文は有効な JSON で指定してください。",
        );
    }
};

externalProvidersApp.get("/", async (c) => {
    try {
        return c.json(await listExternalProviders(c.env.DB), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

externalProvidersApp.post("/", async (c) => {
    try {
        return c.json(
            await createExternalProvider(c.env.DB, await parseJson(c)),
            201,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

externalProvidersApp.get("/:providerId", async (c) => {
    try {
        return c.json(
            await getExternalProvider(c.env.DB, c.req.param("providerId")),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

externalProvidersApp.patch("/:providerId", async (c) => {
    try {
        return c.json(
            await updateExternalProvider(
                c.env.DB,
                c.req.param("providerId"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

externalProvidersApp.delete("/:providerId", async (c) => {
    try {
        await deleteExternalProvider(c.env.DB, c.req.param("providerId"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default externalProvidersApp;
