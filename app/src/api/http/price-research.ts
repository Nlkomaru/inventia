import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    priceResearchCompleteSchema,
    priceResearchCreateSchema,
    priceResearchListOutputSchema,
    priceResearchListQuerySchema,
    priceResearchRequestDtoSchema,
} from "../../domain/priceResearch";
import {
    cancelPriceResearchRequest,
    completePriceResearchRequest,
    createPriceResearchRequest,
    listPriceResearchRequests,
    PriceResearchServiceError,
} from "../../services/priceResearchService";
import type { ApiBindings } from "../bindings";

type PriceResearchContext = Context<ApiBindings>;

export const priceResearchApp = new OpenAPIHono<ApiBindings>();

const priceResearchErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});

const requestIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "id", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });

const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

const errorResponses = {
    400: {
        description: "The request is invalid; correct the reported input.",
        content: responseContent(priceResearchErrorSchema),
    },
    404: {
        description: "The referenced request, item, or store does not exist.",
        content: responseContent(priceResearchErrorSchema),
    },
    409: {
        description:
            "The request is not in pending status or conflicts with current data.",
        content: responseContent(priceResearchErrorSchema),
    },
    500: {
        description: "The service could not complete the request.",
        content: responseContent(priceResearchErrorSchema),
    },
};

priceResearchApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Price Research"],
    summary: "List price research requests",
    description:
        "Lists AI and manual price research requests in reverse chronological order with optional status filtering and cursor pagination. Completed requests include the linked item and recorded price summary with unit price.",
    request: {
        query: priceResearchListQuerySchema,
    },
    responses: {
        200: {
            description: "A stable page of price research requests.",
            content: responseContent(priceResearchListOutputSchema),
        },
        400: errorResponses[400],
        500: errorResponses[500],
    },
});

priceResearchApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Price Research"],
    summary: "Create a price research request",
    description:
        "Creates a pending price research request for a user to fill in. When itemId is provided, requestedItemName and requestedUnit default from the item if omitted.",
    request: {
        body: {
            required: true,
            content: responseContent(priceResearchCreateSchema),
        },
    },
    responses: {
        201: {
            description: "The created price research request.",
            content: responseContent(priceResearchRequestDtoSchema),
        },
        ...errorResponses,
    },
});

priceResearchApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{id}/complete",
    tags: ["Price Research"],
    summary: "Complete a price research request",
    description:
        "Completes a pending price research request by recording a price observation and marking the request completed. If the request has no itemId yet, specify either itemId or newItem.",
    request: {
        params: z.object({ id: requestIdParameter }),
        body: {
            required: true,
            content: responseContent(priceResearchCompleteSchema),
        },
    },
    responses: {
        200: {
            description: "The completed price research request.",
            content: responseContent(priceResearchRequestDtoSchema),
        },
        ...errorResponses,
    },
});

priceResearchApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{id}/cancel",
    tags: ["Price Research"],
    summary: "Cancel a price research request",
    description: "Cancels a pending price research request.",
    request: {
        params: z.object({ id: requestIdParameter }),
    },
    responses: {
        200: {
            description: "The cancelled price research request.",
            content: responseContent(priceResearchRequestDtoSchema),
        },
        ...errorResponses,
    },
});

const isConstraintViolation = (error: unknown): boolean =>
    error instanceof Error &&
    /constraint|unique|foreign key/i.test(error.message);

const errorResponse = (c: PriceResearchContext, error: unknown): Response => {
    if (error instanceof PriceResearchServiceError) {
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
    if (isConstraintViolation(error)) {
        return c.json(
            {
                error: {
                    code: "PRICE_RESEARCH_CONFLICT",
                    message: "価格調査依頼が現在のデータと競合しました",
                },
            },
            409,
        );
    }
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "内部エラーが発生しました",
            },
        },
        500,
    );
};

const parseJson = async (c: PriceResearchContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new PriceResearchServiceError(
            "PRICE_RESEARCH_INVALID_INPUT",
            "リクエスト本文は有効なJSONで指定してください",
        );
    }
};

priceResearchApp.get("/", async (c) => {
    try {
        return c.json(
            await listPriceResearchRequests(c.env, c.req.query()),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

priceResearchApp.post("/", async (c) => {
    try {
        return c.json(
            await createPriceResearchRequest(c.env, await parseJson(c)),
            201,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

priceResearchApp.post("/:id/complete", async (c) => {
    try {
        return c.json(
            await completePriceResearchRequest(
                c.env,
                c.req.param("id"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

priceResearchApp.post("/:id/cancel", async (c) => {
    try {
        return c.json(
            await cancelPriceResearchRequest(c.env, c.req.param("id")),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default priceResearchApp;
