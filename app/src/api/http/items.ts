import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    itemCreateSchema,
    itemDetailDtoSchema,
    itemDtoSchema,
    itemListQuerySchema,
    itemUpdateSchema,
} from "../../domain/item";
import {
    createItem,
    deleteItem,
    getItem,
    ItemServiceError,
    listItems,
    updateItem,
} from "../../services/itemService";
import type { ApiBindings } from "../bindings";

export const itemsApp = new OpenAPIHono<ApiBindings>();

const itemErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const itemIdParameter = z
    .string()
    .min(1)
    .openapi({
        param: { name: "id", in: "path" },
        example: "019fecc7-da09-768f-b6e8-45904d46b277",
    });
const itemListSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});
const deletedSchema = z.object({ deleted: z.literal(true) });
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});
// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(itemErrorSchema),
});
const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

itemsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Items"],
    summary: "Search inventory items",
    operationId: "listItems",
    description:
        "Search item names and filter by category, location, low-stock state, expiry within a number of days (expiringWithinDays), or reading state (readingStatus) with cursor pagination. Each item reports its total quantity plus the expiry summary of its lots: earliestExpiryDate is the earliest expiry date among the lots holding stock (null when none of them has an expiry date) and lotCount is how many lots hold stock. Use GET /api/items/{itemId}/lots or GET /api/items/{id} for the per-expiry breakdown. readingStatus on an item is its stored reading state and is null for an item that has none, which includes every item outside a book category; filtering by readingStatus therefore matches stored reading states only and never returns items without one. Use GET /api/items/{id} for the reading dates.",
    request: { query: itemListQuerySchema },
    responses: {
        200: {
            description: "A stable page of inventory items.",
            content: responseContent(itemListSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_CURSOR.",
        ),
        ...serverErrorResponses,
    },
});
itemsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}",
    tags: ["Items"],
    summary: "Get an inventory item",
    operationId: "getItem",
    description:
        "Returns the item with its expiry lots and its reading state. lots holds one entry per expiry date in FEFO order (earliest expiry first, the lot without an expiry date last) and omits lots at quantity 0, so currentQuantity equals the sum of the returned lot quantities. readingState carries the stored status with startedAt and finishedAt, and is null for an item that has no reading state, which includes every item outside a book category; readingStatus repeats the status of that same row. Set the reading state with PUT /api/items/{itemId}/reading-state.",
    request: { params: z.object({ id: itemIdParameter }) },
    responses: {
        200: {
            description: "The requested inventory item with its expiry lots.",
            content: responseContent(itemDetailDtoSchema),
        },
        400: jsonError("INVALID_ID: the path id is empty."),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        ...serverErrorResponses,
    },
});
itemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Items"],
    summary: "Create an inventory item",
    operationId: "createItem",
    description:
        "Creates an item. expiryDate is the expiry date of the item's initial lot; a positive initial quantity or an expiryDate creates that lot, and a positive initial quantity also records an immutable stocktake movement with its lot allocation. An omitted currentQuantity is 0 except for document categories, where it defaults to 1, so a document created without a quantity already gets that initial lot and stocktake movement; send currentQuantity 0 to create one holding no stock. Later expiry corrections go through PATCH /api/items/{itemId}/lots/{lotId}, and later quantity changes through the adjustment and stocktake endpoints.",
    request: {
        body: {
            required: true,
            content: responseContent(itemCreateSchema),
        },
    },
    responses: {
        201: {
            description: "The created inventory item.",
            content: responseContent(itemDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, BASE_UNIT_REQUIRED (this category has no default unit, so send baseUnit and baseDimension together).",
        ),
        404: jsonError(
            "A referenced record does not exist. Codes: CATEGORY_NOT_FOUND, LOCATION_NOT_FOUND.",
        ),
        ...serverErrorResponses,
    },
});
itemsApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{id}",
    tags: ["Items"],
    summary: "Update an inventory item",
    operationId: "updateItem",
    description:
        "Updates display metadata. Base unit, stock quantity, and lot expiry dates are immutable through this endpoint: change an expiry date with PATCH /api/items/{itemId}/lots/{lotId} and a quantity with the adjustment or stocktake endpoints. Moving an item that holds a reading state out of its book category is rejected, because only items in a book category can hold one; remove it with DELETE /api/items/{itemId}/reading-state first.",
    request: {
        params: z.object({ id: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(itemUpdateSchema),
        },
    },
    responses: {
        200: {
            description: "The updated inventory item.",
            content: responseContent(itemDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, INVALID_ID.",
        ),
        404: jsonError(
            "The item or a referenced record does not exist. Codes: ITEM_NOT_FOUND, CATEGORY_NOT_FOUND, LOCATION_NOT_FOUND.",
        ),
        409: jsonError(
            "The requested category move is not allowed. Codes: ITEM_CATEGORY_KIND_CONFLICT (an item cannot move across the document and non-document category boundary), ITEM_READING_STATE_CONFLICT (the item still holds a reading state; remove it with DELETE /api/items/{itemId}/reading-state before moving the item out of a book category).",
        ),
        ...serverErrorResponses,
    },
});
itemsApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}",
    tags: ["Items"],
    summary: "Delete an inventory item",
    operationId: "deleteItem",
    description:
        "Deletes an item that has no stock history, together with its lots that hold no stock and are not referenced by a movement. An item with recorded stock movements cannot be deleted.",
    request: { params: z.object({ id: itemIdParameter }) },
    responses: {
        200: {
            description: "The item was deleted.",
            content: responseContent(deletedSchema),
        },
        400: jsonError("INVALID_ID: the path id is empty."),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        409: jsonError(
            "ITEM_DELETE_CONFLICT: the item has stock history and cannot be deleted.",
        ),
        ...serverErrorResponses,
    },
});

type ItemsContext = Context<ApiBindings>;

type ErrorResponse = {
    error: {
        code: string;
        message: string;
    };
};

const errorResponse = (c: ItemsContext, error: unknown): Response => {
    if (error instanceof ItemServiceError) {
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

const parseJson = async (c: ItemsContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new ItemServiceError(
            400,
            "INVALID_JSON",
            "request body must be valid JSON",
        );
    }
};

itemsApp.get("/", async (c) => {
    try {
        return c.json(await listItems(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.get("/:id", async (c) => {
    try {
        return c.json(await getItem(c.env.DB, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.post("/", async (c) => {
    try {
        return c.json(await createItem(c.env.DB, await parseJson(c)), 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.patch("/:id", async (c) => {
    try {
        return c.json(
            await updateItem(c.env.DB, c.req.param("id"), await parseJson(c)),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.delete("/:id", async (c) => {
    try {
        await deleteItem(c.env.DB, c.req.param("id"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default itemsApp;
