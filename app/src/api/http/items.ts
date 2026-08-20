import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    itemCreateSchema,
    itemDetailDtoSchema,
    itemDtoSchema,
    itemListQuerySchema,
    itemSemanticSearchQuerySchema,
    itemSemanticSearchResultSchema,
    itemUpdateSchema,
} from "../../domain/item";
import { EmbeddingServiceError } from "../../services/embeddingService";
import {
    indexItem,
    reindexAllItems,
    removeItemFromIndex,
    searchItemsByVector,
} from "../../services/itemSearchService";
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
// 再索引の集計。1 品目単位の索引更新は best-effort で結果を返さないため、
// この経路だけが利用者へ結果件数を示す
const itemReindexResultSchema = z.object({
    indexed: z.int().min(0),
    failed: z.int().min(0),
});
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
        "Search item names and filter by category, location, low-stock state, expiry within a number of days (expiringWithinDays), or reading state (readingStatus) with cursor pagination. Each item reports its total quantity plus the expiry summary of its lots: earliestExpiryDate is the earliest expiry date among the lots holding stock (null when none of them has an expiry date) and lotCount is how many lots hold stock. Use GET /api/items/{itemId}/lots or GET /api/items/{id} for the per-expiry breakdown. readingStatus on an item is its stored reading state and is null for an item that has none, which includes every item outside a book category; filtering by readingStatus therefore matches stored reading states only and never returns items without one. Use GET /api/items/{id} for the reading dates. Results are ordered by item name unless sort is expiry, which orders by the soonest expiry among the lots holding stock and puts items without one last; a cursor belongs to the sort it was made with and is rejected when replayed under the other one.",
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
    path: "/search/semantic",
    tags: ["Items"],
    summary: "Search inventory items by meaning",
    operationId: "searchItemsSemantic",
    description:
        "Finds items whose stored name is semantically similar to q, using embeddings generated from item names and matched through Cloudflare Vectorize. This is a supplement to GET /api/items's name search (the q parameter there), not a replacement: it can match items even when the query uses different wording than the stored name, but only items that have been indexed can be returned. Indexing runs best-effort whenever an item is created or updated, so an item can be missing from these results when the OpenRouter API key was not configured at index time or the indexing call itself failed; POST /api/items/reindex recovers from that by rebuilding the index for every item. There is no cursor and no nextCursor in the response: results are cut off at topK (default 20, maximum 100) because the underlying vector query has no paging.",
    request: { query: itemSemanticSearchQuerySchema },
    responses: {
        200: {
            description:
                "Items ordered by similarity to q, most similar first. May be shorter than topK, and never includes items that were never indexed.",
            content: responseContent(itemSemanticSearchResultSchema),
        },
        400: jsonError(
            "VALIDATION_ERROR: q is empty or over 200 characters, or topK is out of range (1-100).",
        ),
        503: jsonError(
            "EMBEDDING_NOT_CONFIGURED: the OpenRouter API key is not stored. Save it from the integration settings, or use POST /api/items/reindex once it is saved.",
        ),
        502: jsonError(
            "The embedding provider could not complete the request. Codes: EMBEDDING_PROVIDER_ERROR (OpenRouter could not be reached or returned an error), EMBEDDING_INVALID_RESPONSE (the response could not be read). Retry later.",
        ),
        ...serverErrorResponses,
    },
});
itemsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/reindex",
    tags: ["Items"],
    summary: "Rebuild the semantic search index",
    operationId: "reindexItems",
    description:
        "Rebuilds the semantic search index used by GET /api/items/search/semantic: regenerates the embedding for every item from its current name and upserts it into Vectorize, in batches of up to 100 items. Side effects: calls the configured OpenRouter embeddings API once per batch and overwrites the stored vectors, so it takes time and OpenRouter usage proportional to the number of items. Use it to recover items missed by the best-effort per-item indexing, for example right after the OpenRouter API key is configured for the first time. A batch that fails for a transient reason is counted in failed and does not stop the remaining batches, so a positive failed leaves some items unindexed and worth retrying; if the OpenRouter API key is not configured, every batch would fail the same way, so the whole run stops immediately and the response is 503 instead of a misleadingly successful 200.",
    responses: {
        200: {
            description:
                "The reindex ran to completion. indexed is the number of items whose vector was written; failed is the number of items whose batch could not be embedded or upserted.",
            content: responseContent(itemReindexResultSchema),
        },
        503: jsonError(
            "EMBEDDING_NOT_CONFIGURED: the OpenRouter API key is not stored. Save it from the integration settings, then retry.",
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
        "Updates the item master data: name, categoryId, locationId, baseUnit, baseDimension, lowStockThreshold, and memo. At least one field is required, and the fields you omit stay unchanged. baseUnit and baseDimension changes relabel the item without converting existing quantities: the item's current quantity, its lots, its stock movements, its price records and its low-stock threshold all keep their stored numbers, so the same numbers simply start meaning the new unit. The low-stock threshold is expressed in the base unit, so send a corrected lowStockThreshold in the same request or in a follow-up PATCH after relabelling. Warn the user before sending one for an item that already holds stock or history. A baseDimension change must send baseUnit in the same request, because a dimension left with the previous dimension's unit is never what the caller meant; baseUnit alone is accepted for relabelling within the same dimension. Stock quantity and lot expiry dates remain immutable through this endpoint: change an expiry date with PATCH /api/items/{itemId}/lots/{lotId} and a quantity with the adjustment or stocktake endpoints. Moving an item that holds a reading state out of its book category is rejected, because only items in a book category can hold one; remove it with DELETE /api/items/{itemId}/reading-state first.",
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
            "The requested update is not allowed. Codes: ITEM_CATEGORY_KIND_CONFLICT (an item cannot move across the document and non-document category boundary), ITEM_READING_STATE_CONFLICT (the item still holds a reading state; remove it with DELETE /api/items/{itemId}/reading-state before moving the item out of a book category), ITEM_PRICE_UNIT_CONFLICT (the item holds price records whose unit price is derived from the base unit, so a mass base unit must be g or kg and a volume base unit must be mL or L).",
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

// EmbeddingServiceError のコードを利用者が対処できる HTTP status へ写す。
// 入力不備は 400、API key 未設定は復旧手段のある 503、上流の失敗は 502
const embeddingErrorResponse = (
    c: ItemsContext,
    error: EmbeddingServiceError,
): Response => {
    const status =
        error.code === "EMBEDDING_INVALID_INPUT"
            ? 400
            : error.code === "EMBEDDING_NOT_CONFIGURED"
              ? 503
              : 502;
    return c.json(
        {
            error: {
                code: error.code,
                message: error.message,
            },
        } satisfies ErrorResponse,
        status,
    );
};

itemsApp.get("/", async (c) => {
    try {
        return c.json(await listItems(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

// registerPath の query スキーマは OpenAPI ドキュメント用で実行時の検証はしないため、
// ここで itemSemanticSearchQuerySchema を明示的に検証する
itemsApp.get("/search/semantic", async (c) => {
    const parsed = itemSemanticSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json(
            {
                error: {
                    code: "VALIDATION_ERROR",
                    message:
                        parsed.error.issues[0]?.message ??
                        "the query is invalid",
                },
            } satisfies ErrorResponse,
            400,
        );
    }
    try {
        const items = await searchItemsByVector(c.env, parsed.data.q, {
            topK: parsed.data.topK,
        });
        return c.json({ items }, 200);
    } catch (error) {
        if (error instanceof EmbeddingServiceError) {
            return embeddingErrorResponse(c, error);
        }
        return errorResponse(c, error);
    }
});

// 全品目の embedding を作り直す更新系エンドポイント。副作用は OpenAPI の
// description に明記する
itemsApp.post("/reindex", async (c) => {
    try {
        return c.json(await reindexAllItems(c.env), 200);
    } catch (error) {
        if (error instanceof EmbeddingServiceError) {
            return embeddingErrorResponse(c, error);
        }
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
        const created = await createItem(c.env.DB, await parseJson(c));
        // 索引更新は best-effort（内部で例外を握り潰す）。この worker には
        // ExecutionContext が渡らないため waitUntil は使えず、応答を返す前に await する
        await indexItem(c.env, created.id);
        return c.json(created, 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.patch("/:id", async (c) => {
    try {
        const body = await parseJson(c);
        const updated = await updateItem(c.env.DB, c.req.param("id"), body);
        // 埋め込み対象は品目名だけなので、name を送っていない更新では索引を触らない
        const parsedUpdate = itemUpdateSchema.safeParse(body);
        if (parsedUpdate.success && parsedUpdate.data.name !== undefined) {
            await indexItem(c.env, updated.id);
        }
        return c.json(updated, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

itemsApp.delete("/:id", async (c) => {
    try {
        const id = c.req.param("id");
        await deleteItem(c.env.DB, id);
        await removeItemFromIndex(c.env, id);
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default itemsApp;
