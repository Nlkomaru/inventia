import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    itemLotListDtoSchema,
    lotListQuerySchema,
    lotUpdateSchema,
} from "../../domain/lot";
import {
    LotServiceError,
    listItemLots,
    updateLotExpiryDate,
} from "../../services/lotService";
import type { ApiBindings } from "../bindings";

type LotsContext = Context<ApiBindings>;

export const lotsApp = new OpenAPIHono<ApiBindings>();

const lotErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const itemIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "itemId", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });
const lotIdParameter = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .openapi({
        param: { name: "lotId", in: "path" },
        example: "019fecd1-6b3e-7c40-9a51-0f4f2b1d8c33",
    });
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(lotErrorSchema),
});

const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

lotsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{itemId}/lots",
    tags: ["Inventory"],
    summary: "List an item's expiry lots",
    operationId: "listItemLots",
    description:
        "Lists the item's stock lots in FEFO order: expiry date ascending, the lot without an expiry date last. Only lots holding stock are returned, so their quantities sum to the item's current quantity; pass includeEmpty=true to also list lots at quantity 0. Emptied lots are kept as rows because stock movement allocations reference them. The storage location is a property of the item, not of a lot.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        query: lotListQuerySchema,
    },
    responses: {
        200: {
            description: "The item's expiry lots in FEFO order.",
            content: responseContent(itemLotListDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_ID.",
        ),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        ...serverErrorResponses,
    },
});

lotsApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{itemId}/lots/{lotId}",
    tags: ["Inventory"],
    summary: "Correct an expiry lot's expiry date",
    operationId: "updateItemLotExpiryDate",
    description:
        "Corrects the expiry date of one lot. expiryDate is required and accepts null, which turns the lot into the lot without an expiry date. When the item already has a lot with the requested expiry date, the two are merged: the quantity moves into that lot and the corrected lot stays as a row with quantity 0 because stock movement allocations reference it. Side effects are limited to the lot rows: the item's total quantity never changes, so no stock movement is recorded. Past movement allocations keep the expiry date recorded at the time of the movement, so history is not rewritten. Use the adjustment and stocktake endpoints to change quantities. Returns the item's lots holding stock in FEFO order.",
    request: {
        params: z.object({ itemId: itemIdParameter, lotId: lotIdParameter }),
        body: {
            required: true,
            content: responseContent(lotUpdateSchema),
        },
    },
    responses: {
        200: {
            description:
                "The item's expiry lots in FEFO order after the correction.",
            content: responseContent(itemLotListDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, INVALID_ID.",
        ),
        404: jsonError(
            "The target does not exist. Codes: ITEM_NOT_FOUND, LOT_NOT_FOUND (the lot does not belong to this item; pick a target from the lot list).",
        ),
        409: jsonError(
            "STOCK_LOT_CONFLICT: the lots changed while the correction was applied. Reload the lots and try again.",
        ),
        ...serverErrorResponses,
    },
});

type ErrorResponse = {
    error: {
        code: string;
        message: string;
    };
};

const errorResponse = (c: LotsContext, error: unknown): Response => {
    if (error instanceof LotServiceError) {
        return c.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            } satisfies ErrorResponse,
            error.status,
        );
    }
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "an internal error occurred",
            },
        } satisfies ErrorResponse,
        500,
    );
};

const parseJson = async (c: LotsContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new LotServiceError(
            400,
            "INVALID_JSON",
            "request body must be valid JSON",
        );
    }
};

lotsApp.get("/:itemId/lots", async (c) => {
    try {
        return c.json(
            await listItemLots(c.env.DB, c.req.param("itemId"), c.req.query()),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

lotsApp.patch("/:itemId/lots/:lotId", async (c) => {
    try {
        return c.json(
            await updateLotExpiryDate(
                c.env.DB,
                c.req.param("itemId"),
                c.req.param("lotId"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default lotsApp;
