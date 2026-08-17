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

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(stockErrorSchema),
});

const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

stockItemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{itemId}/adjustments",
    tags: ["Inventory"],
    summary: "Adjust item stock",
    operationId: "adjustItemStock",
    description:
        "Applies a signed stock delta to the item's expiry lots; delta must not be 0. Side effects: lot quantities change, an immutable stock movement and its per-lot allocations are recorded, and the item's cached total quantity is recomputed from the lots. A positive delta is added to the lot with the given expiryDate, creating that lot when it does not exist yet; omitting expiryDate or sending null targets the lot without an expiry date. A negative delta is subtracted from the lot named by lotId or expiryDate; omitting both consumes lots in FEFO order (earliest expiry first, the lot without an expiry date last), while an explicit expiryDate of null targets the lot without an expiry date. lotId and expiryDate cannot be sent together. Retrying with the same idempotencyKey returns the stored operation instead of applying the delta twice.",
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
                "The idempotent replay of an existing stock operation. currentQuantity and lots describe the current state, while movement and allocations are the stored breakdown of the original operation.",
            content: responseContent(stockOperationResultSchema),
        },
        201: {
            description:
                "The stock adjustment was recorded. currentQuantity always equals the sum of the returned lots.",
            content: responseContent(stockOperationResultSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, INVALID_ID, INVALID_OCCURRED_AT.",
        ),
        404: jsonError(
            "The target does not exist. Codes: ITEM_NOT_FOUND, LOT_NOT_FOUND (the requested lotId or expiryDate has no lot; pick a target from the lot list).",
        ),
        409: jsonError(
            "The adjustment conflicts with current inventory data. Codes: INSUFFICIENT_STOCK (the issue exceeds the targeted lots), IDEMPOTENCY_CONFLICT (the same idempotencyKey was used for a different request), STOCK_LOT_CONFLICT (the lots changed concurrently; reload the lots and retry).",
        ),
        ...serverErrorResponses,
    },
});

stockItemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{itemId}/stocktake",
    tags: ["Inventory"],
    summary: "Record an item stocktake",
    operationId: "recordItemStocktake",
    description:
        "Records a counted stock state as absolute quantities. Send lots to confirm the quantity of every expiry date, or quantity to confirm the item total; exactly one of the two is required. A stocktake is a full count: lots absent from the request become 0. Each expiry date may appear only once in lots. quantity is rejected with STOCKTAKE_TOTAL_AMBIGUOUS when the item holds stock in more than one lot, because splitting a total across expiry dates cannot be inferred; send lots instead. Side effects: the counted lots are set to the given quantities, the item's cached total quantity is recomputed from the lots, and a stock movement with reason stocktake plus its per-lot allocations is recorded. A movement is also recorded when the total is unchanged but the per-lot breakdown moved; a count that changes nothing records no movement and returns movement as null. Retrying with the same idempotencyKey returns the stored operation instead of counting twice.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(stocktakeSchema),
        },
    },
    responses: {
        200: {
            description:
                "The idempotent replay of an existing stocktake. currentQuantity and lots describe the current state, while movement and allocations are the stored breakdown of the original operation.",
            content: responseContent(stockOperationResultSchema),
        },
        201: {
            description:
                "The stocktake was recorded. currentQuantity always equals the sum of the returned lots.",
            content: responseContent(stockOperationResultSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, INVALID_ID, INVALID_OCCURRED_AT, STOCKTAKE_TOTAL_AMBIGUOUS (send lots instead of quantity), LOT_DUPLICATE_EXPIRY (merge the duplicated expiry date into one entry).",
        ),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        409: jsonError(
            "The stocktake conflicts with current inventory data. Codes: IDEMPOTENCY_CONFLICT (the same idempotencyKey was used for a different request), STOCK_LOT_CONFLICT (the lots changed after they were read, so the full count could not be confirmed; reload the lots and count again).",
        ),
        ...serverErrorResponses,
    },
});

stockItemsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{itemId}/history",
    tags: ["Inventory"],
    summary: "List an item's stock history",
    operationId: "listItemStockHistory",
    description:
        "Lists immutable stock movements for one item in reverse chronological order with scoped cursor pagination. Each movement carries its per-lot allocations; the expiry date in an allocation is the value recorded at the time of the movement, so later expiry corrections never rewrite history. Movements recorded before lot tracking existed have an empty allocations array.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        query: stockHistoryItemQuerySchema,
    },
    responses: {
        200: {
            description: "A stable page of stock movements.",
            content: responseContent(stockHistoryResultSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_CURSOR.",
        ),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        ...serverErrorResponses,
    },
});

stockInventoryApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/history",
    tags: ["Inventory"],
    summary: "List stock history",
    operationId: "listStockHistory",
    description:
        "Lists immutable stock movements across inventory, optionally filtered by item or reason. Each movement carries its per-lot allocations; the expiry date in an allocation is the value recorded at the time of the movement, so later expiry corrections never rewrite history. Movements recorded before lot tracking existed have an empty allocations array.",
    request: { query: stockHistoryQuerySchema },
    responses: {
        200: {
            description: "A stable page of stock movements.",
            content: responseContent(stockHistoryResultSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_CURSOR.",
        ),
        404: jsonError(
            "The item named by itemId does not exist: ITEM_NOT_FOUND.",
        ),
        ...serverErrorResponses,
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
