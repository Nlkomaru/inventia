import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    readingStateDtoSchema,
    readingStateUpsertSchema,
} from "../../domain/reading";
import {
    clearReadingState,
    ReadingServiceError,
    setReadingState,
} from "../../services/readingService";
import type { ApiBindings } from "../bindings";

type ReadingContext = Context<ApiBindings>;

export const readingApp = new OpenAPIHono<ApiBindings>();

const readingErrorSchema = z.object({
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
const clearedSchema = z.object({ deleted: z.literal(true) });
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

// エラー応答は利用者が対処できるコードを description に列挙する
const jsonError = (description: string) => ({
    description,
    content: responseContent(readingErrorSchema),
});

const serverErrorResponses = {
    500: jsonError("The service could not complete the request."),
};

readingApp.openAPIRegistry.registerPath({
    method: "put",
    path: "/{itemId}/reading-state",
    tags: ["Items"],
    summary: "Set an item's reading state",
    operationId: "setItemReadingState",
    description:
        "Creates or replaces the reading state of one item; only items in a book category have one, and any other item is rejected with NOT_A_BOOK_ITEM. The category kind is resolved through the category ancestors, so a subcategory of a book category counts as a book. Side effects are limited to the reading state row: stock quantities, lots, and movements are never touched. This is a full replacement, not a partial update: startedAt and finishedAt that are omitted or sent as null are stored as empty. The dates must agree with the status, so startedAt and finishedAt must both be empty while the status is unread, finishedAt must be empty while the status is reading, and finishedAt must not be earlier than startedAt. Date-times are accepted with any offset and stored and returned as ISO 8601 UTC.",
    request: {
        params: z.object({ itemId: itemIdParameter }),
        body: {
            required: true,
            content: responseContent(readingStateUpsertSchema),
        },
    },
    responses: {
        200: {
            description: "The stored reading state.",
            content: responseContent(readingStateDtoSchema),
        },
        400: jsonError(
            "The request is invalid; correct the reported input. Codes: VALIDATION_ERROR, INVALID_JSON, INVALID_ID, INVALID_READING_DATES (the dates contradict the status; the message names the rule that failed).",
        ),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        409: jsonError(
            "NOT_A_BOOK_ITEM: the item is not in a book category, so it cannot hold a reading state.",
        ),
        ...serverErrorResponses,
    },
});

readingApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{itemId}/reading-state",
    tags: ["Items"],
    summary: "Clear an item's reading state",
    operationId: "clearItemReadingState",
    description:
        "Removes the item's reading state. Side effects are limited to the reading state row: stock quantities, lots, and movements are never touched. The call succeeds even when the item has no reading state, so repeating it is safe. Only the item has to exist; its category kind is not checked. Call this before moving an item out of a book category, because PATCH /api/items/{id} rejects that move while a reading state is stored.",
    request: { params: z.object({ itemId: itemIdParameter }) },
    responses: {
        200: {
            description:
                "The item has no reading state; it was removed or never existed.",
            content: responseContent(clearedSchema),
        },
        400: jsonError("INVALID_ID: the path itemId is empty."),
        404: jsonError("The requested item does not exist: ITEM_NOT_FOUND."),
        ...serverErrorResponses,
    },
});

type ErrorResponse = {
    error: {
        code: string;
        message: string;
    };
};

const errorResponse = (c: ReadingContext, error: unknown): Response => {
    if (error instanceof ReadingServiceError) {
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

const parseJson = async (c: ReadingContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new ReadingServiceError(
            400,
            "INVALID_JSON",
            "request body must be valid JSON",
        );
    }
};

readingApp.put("/:itemId/reading-state", async (c) => {
    try {
        return c.json(
            await setReadingState(
                c.env.DB,
                c.req.param("itemId"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

readingApp.delete("/:itemId/reading-state", async (c) => {
    try {
        await clearReadingState(c.env.DB, c.req.param("itemId"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default readingApp;
