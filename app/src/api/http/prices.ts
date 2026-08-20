import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    allPriceRecordListInputSchema,
    allPriceRecordListOutputSchema,
    priceRecordCreateInputSchema,
    priceRecordDtoSchema,
    priceRecordListInputSchema,
    priceRecordListOutputSchema,
} from "../../domain/price";
import {
    createPriceRecord,
    listAllPriceRecords,
    listPriceRecords,
    PriceServiceError,
} from "../../services/priceService";
import type { ApiBindings } from "../bindings";

type PricesContext = Context<ApiBindings>;

export const pricesApp = new OpenAPIHono<ApiBindings>();

/**
 * 品目に紐付かない価格の一覧。`pricesApp` は "/api/items" 配下に載るため、
 * 全品目を横断するこの一覧だけ別の app にして "/api/prices" へ載せる。
 */
export const priceRecordsApp = new OpenAPIHono<ApiBindings>();

const priceErrorSchema = z.object({
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
const priceCreateBodySchema = priceRecordCreateInputSchema.omit({
    itemId: true,
});
const priceListQuerySchema = priceRecordListInputSchema.omit({
    itemId: true,
});
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});
const errorResponses = {
    400: {
        description: "The request is invalid; correct the reported input.",
        content: responseContent(priceErrorSchema),
    },
    404: {
        description:
            "The referenced record does not exist. Codes: PRICE_ITEM_NOT_FOUND (the item does not exist), PRICE_STORE_NOT_FOUND (storeId does not match any store; create the store first).",
        content: responseContent(priceErrorSchema),
    },
    409: {
        description: "The price record conflicts with current inventory data.",
        content: responseContent(priceErrorSchema),
    },
    500: {
        description: "The service could not complete the request.",
        content: responseContent(priceErrorSchema),
    },
};

pricesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{itemId}/prices",
    tags: ["Prices"],
    summary: "List an item's price history",
    description:
        "Lists price observations for one item in reverse chronological order with cursor pagination.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        query: priceListQuerySchema,
    },
    responses: {
        200: {
            description: "A stable page of price observations.",
            content: responseContent(priceRecordListOutputSchema),
        },
        ...errorResponses,
    },
});

pricesApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/{itemId}/prices",
    tags: ["Prices"],
    summary: "Record an item price",
    description:
        "Adds a price observation. Unit price is calculated when the record is read and is not stored. Send storeId to link the record to a store, source to name the origin as free text, or both; when only storeId is sent the store name is copied into source. Omitting both is refused.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(priceCreateBodySchema),
        },
    },
    responses: {
        201: {
            description: "The created price observation.",
            content: responseContent(priceRecordDtoSchema),
        },
        ...errorResponses,
    },
});

priceRecordsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Prices"],
    summary: "List price records across items",
    description:
        "Lists price observations for every item in reverse chronological order with cursor pagination. Each record carries the item it belongs to as itemId, itemName and itemEmoji, so the caller does not have to read the items separately. Cursors from an item's own price history are not accepted here.",
    request: {
        query: allPriceRecordListInputSchema,
    },
    responses: {
        200: {
            description: "A stable page of price observations.",
            content: responseContent(allPriceRecordListOutputSchema),
        },
        400: errorResponses[400],
        500: errorResponses[500],
    },
});

const isConstraintViolation = (error: unknown): boolean =>
    error instanceof Error &&
    /constraint|unique|foreign key/i.test(error.message);

const errorResponse = (c: PricesContext, error: unknown): Response => {
    if (error instanceof PriceServiceError) {
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
                    code: "PRICE_CONFLICT",
                    message: "価格履歴が現在のデータと競合しました",
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

const parseJson = async (c: PricesContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new PriceServiceError(
            "PRICE_INVALID_INPUT",
            "リクエスト本文は有効なJSONで指定してください",
        );
    }
};

const withItemId = (itemId: string, body: unknown): unknown => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return body;
    }
    return { ...body, itemId };
};

pricesApp.get("/:itemId/prices", async (c) => {
    try {
        return c.json(
            await listPriceRecords(c.env.DB, {
                ...c.req.query(),
                itemId: c.req.param("itemId"),
            }),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

pricesApp.post("/:itemId/prices", async (c) => {
    try {
        return c.json(
            await createPriceRecord(
                c.env.DB,
                withItemId(c.req.param("itemId"), await parseJson(c)),
            ),
            201,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

priceRecordsApp.get("/", async (c) => {
    try {
        return c.json(await listAllPriceRecords(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default pricesApp;
