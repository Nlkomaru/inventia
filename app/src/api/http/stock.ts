import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    stockAdjustmentSchema,
    stockHistoryQuerySchema,
    stockHistoryResultSchema,
    stockOperationResultSchema,
    stocktakeSchema,
} from "../../domain/stock";
import {
    adjustStock,
    listStockHistory,
    StockServiceError,
    stocktake,
} from "../../services/stockService";
import type { ApiBindings } from "../bindings";

type StockContext = Context<ApiBindings>;

export const stockItemsApp = new OpenAPIHono<ApiBindings>();
export const stockInventoryApp = new OpenAPIHono<ApiBindings>();

const stockErrorSchema = z
    .object({
        error: z
            .object({
                code: z.string(),
                message: z.string(),
            })
            .strict(),
    })
    .strict();

const itemIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "itemId", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });

const stockHistoryItemQuerySchema = stockHistoryQuerySchema.omit({
    itemId: true,
});

const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

const errorResponses = {
    400: {
        description: "The request is invalid; correct the reported input.",
        content: responseContent(stockErrorSchema),
    },
    404: {
        description: "The requested item does not exist.",
        content: responseContent(stockErrorSchema),
    },
    409: {
        description:
            "The stock operation conflicts with current inventory data or an existing idempotency key.",
        content: responseContent(stockErrorSchema),
    },
    500: {
        description: "The service could not complete the request.",
        content: responseContent(stockErrorSchema),
    },
};

stockItemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{itemId}/adjustments",
    tags: ["Inventory"],
    summary: "Adjust item stock",
    description:
        "Records a non-zero stock delta with a reason and applies it atomically to the item's current quantity.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(stockAdjustmentSchema),
        },
    },
    responses: {
        200: {
            description:
                "The idempotent replay of an existing stock operation.",
            content: responseContent(stockOperationResultSchema),
        },
        201: {
            description: "The stock adjustment was recorded.",
            content: responseContent(stockOperationResultSchema),
        },
        ...errorResponses,
    },
});

stockItemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{itemId}/stocktake",
    tags: ["Inventory"],
    summary: "Record an item stocktake",
    description:
        "Accepts an absolute quantity and records the difference from the transaction's current quantity.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(stocktakeSchema),
        },
    },
    responses: {
        200: {
            description: "The idempotent replay of an existing stocktake.",
            content: responseContent(stockOperationResultSchema),
        },
        201: {
            description: "The stocktake was recorded.",
            content: responseContent(stockOperationResultSchema),
        },
        ...errorResponses,
    },
});

stockItemsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{itemId}/history",
    tags: ["Inventory"],
    summary: "List an item's stock history",
    description:
        "Lists immutable stock movements for one item in reverse chronological order with scoped cursor pagination.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        query: stockHistoryItemQuerySchema,
    },
    responses: {
        200: {
            description: "A stable page of stock movements.",
            content: responseContent(stockHistoryResultSchema),
        },
        ...errorResponses,
    },
});

stockInventoryApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/history",
    tags: ["Inventory"],
    summary: "List stock history",
    description:
        "Lists immutable stock movements across inventory, optionally filtered by item or reason.",
    request: { query: stockHistoryQuerySchema },
    responses: {
        200: {
            description: "A stable page of stock movements.",
            content: responseContent(stockHistoryResultSchema),
        },
        ...errorResponses,
    },
});

const errorResponse = (c: StockContext, error: unknown): Response => {
    if (error instanceof StockServiceError) {
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
                message: "an internal error occurred",
            },
        },
        500,
    );
};

const parseJson = async (c: StockContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new StockServiceError(
            400,
            "INVALID_JSON",
            "request body must be valid JSON",
        );
    }
};

const operationStatus = (replayed: boolean): 200 | 201 =>
    replayed ? 200 : 201;

stockItemsApp.post("/:itemId/adjustments", async (c) => {
    try {
        const result = await adjustStock(
            c.env.DB,
            c.req.param("itemId"),
            await parseJson(c),
        );
        return c.json(result, operationStatus(result.replayed));
    } catch (error) {
        return errorResponse(c, error);
    }
});

stockItemsApp.post("/:itemId/stocktake", async (c) => {
    try {
        const result = await stocktake(
            c.env.DB,
            c.req.param("itemId"),
            await parseJson(c),
        );
        return c.json(result, operationStatus(result.replayed));
    } catch (error) {
        return errorResponse(c, error);
    }
});

stockItemsApp.get("/:itemId/history", async (c) => {
    try {
        return c.json(
            await listStockHistory(c.env.DB, {
                ...c.req.query(),
                // The path is authoritative; query strings cannot override it.
                itemId: c.req.param("itemId"),
            }),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

stockInventoryApp.get("/history", async (c) => {
    try {
        return c.json(await listStockHistory(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default stockItemsApp;
