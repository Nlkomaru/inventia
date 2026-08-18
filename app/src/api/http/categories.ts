import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    categoryCreateInputSchema,
    categoryDeleteOutputSchema,
    categoryDtoSchema,
    categoryListInputSchema,
    categoryListOutputSchema,
    categoryUpdateInputSchema,
} from "../../domain/category";
import {
    CategoryServiceError,
    createCategory,
    getCategory,
    listCategories,
    removeCategory,
    updateCategory,
} from "../../services/categoryService";
import type { ApiBindings } from "../bindings";

type CategoriesContext = Context<ApiBindings>;

export const categoriesApp = new OpenAPIHono<ApiBindings>();

const categoryErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const categoryIdParameter = z
    .string()
    .min(1)
    .openapi({
        param: { name: "id", in: "path" },
        example: "019fecc7-b5ed-71d4-9ed3-fc56612cb7ae",
    });
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});
const jsonError = (description: string) => ({
    description,
    content: responseContent(categoryErrorSchema),
});
const internalError = jsonError("The service could not complete the request.");

categoriesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Categories"],
    summary: "List categories",
    description:
        "Lists one level of the category tree with stable cursor pagination.",
    request: { query: categoryListInputSchema },
    responses: {
        200: {
            description: "A stable page of categories.",
            content: responseContent(categoryListOutputSchema),
        },
        400: {
            description: "The request is invalid; correct the reported input.",
            content: responseContent(categoryErrorSchema),
        },
        500: {
            description: "The service could not complete the request.",
            content: responseContent(categoryErrorSchema),
        },
    },
});
categoriesApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}",
    tags: ["Categories"],
    operationId: "getCategory",
    summary: "Get a category",
    description:
        "Returns one category by its system id. This endpoint only reads data. kind is null for a generic category, whose effective kind is resolved by walking up its ancestors.",
    request: { params: z.object({ id: categoryIdParameter }) },
    responses: {
        200: {
            description: "The requested category.",
            content: responseContent(categoryDtoSchema),
        },
        400: jsonError("CATEGORY_INVALID_INPUT: the category id is empty."),
        404: jsonError("CATEGORY_NOT_FOUND: the category does not exist."),
        500: internalError,
    },
});
categoriesApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Categories"],
    operationId: "createCategory",
    summary: "Create a category",
    description:
        "Creates one category under parentId, or at the root when parentId is null. Side effects: one category row is created; no item, stock or price data changes. Names must be unique among the siblings of the same parent, including at the root: the unique index cannot cover NULL parents, so this endpoint always checks the level itself before inserting. kind may be left null for a generic category, whose effective kind is resolved from its ancestors.",
    request: {
        body: {
            required: true,
            content: responseContent(categoryCreateInputSchema),
        },
    },
    responses: {
        201: {
            description: "The created category.",
            content: responseContent(categoryDtoSchema),
        },
        400: jsonError(
            "CATEGORY_INVALID_INPUT: name, parentId, kind or sortOrder is out of range or unknown.",
        ),
        409: jsonError(
            "CATEGORY_NAME_CONFLICT: a sibling of the same parent already uses that name. Rename it or choose another parent.",
        ),
        422: jsonError(
            "CATEGORY_PARENT_NOT_FOUND: parentId does not exist; create the parent first or use null.",
        ),
        500: internalError,
    },
});
categoriesApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{id}",
    tags: ["Categories"],
    operationId: "updateCategory",
    summary: "Update a category",
    description:
        "Renames, reorders, retypes, or moves one category without allowing tree cycles. Side effects: the category row is updated; existing items keep their category and no stock changes. Only the given fields change, and at least one is required; passing kind as null clears it back to a generic category. A move is refused when the new parent is the category itself or one of its descendants, and the target level is checked for a sibling with the same name, root levels included.",
    request: {
        params: z.object({ id: categoryIdParameter }),
        body: {
            required: true,
            content: responseContent(categoryUpdateInputSchema),
        },
    },
    responses: {
        200: {
            description: "The updated category.",
            content: responseContent(categoryDtoSchema),
        },
        400: jsonError(
            "CATEGORY_INVALID_INPUT: no field was given, or a field is out of range or unknown.",
        ),
        404: jsonError("CATEGORY_NOT_FOUND: the category does not exist."),
        409: jsonError(
            "Codes: CATEGORY_NAME_CONFLICT (a sibling of the target parent already uses that name), CATEGORY_CONFLICT (the update was rejected by a database constraint; review the values and retry).",
        ),
        422: jsonError(
            "Codes: CATEGORY_PARENT_NOT_FOUND (parentId does not exist), CATEGORY_PARENT_CYCLE (parentId is the category itself or one of its descendants; move the subtree first).",
        ),
        500: internalError,
    },
});
categoriesApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}",
    tags: ["Categories"],
    operationId: "deleteCategory",
    summary: "Delete a category",
    description:
        "Deletes one category that has no child categories and no referencing items. Side effects: the category row is removed; nothing else is deleted or reassigned. Items are never moved to another category by this endpoint, so a category still in use has to be emptied first.",
    request: { params: z.object({ id: categoryIdParameter }) },
    responses: {
        200: {
            description: "The category was deleted.",
            content: responseContent(categoryDeleteOutputSchema),
        },
        400: jsonError("CATEGORY_INVALID_INPUT: the category id is empty."),
        404: jsonError("CATEGORY_NOT_FOUND: the category does not exist."),
        409: jsonError(
            "Codes: CATEGORY_HAS_CHILDREN (move or delete the child categories first), CATEGORY_IN_USE (items still reference it; change their category first).",
        ),
        500: internalError,
    },
});

const errorResponse = (c: CategoriesContext, error: unknown): Response => {
    if (error instanceof CategoryServiceError) {
        return c.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            error.status as 400 | 404 | 409 | 422 | 500,
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

const parseJson = async (c: CategoriesContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new CategoryServiceError(
            "CATEGORY_INVALID_INPUT",
            "リクエスト本文は有効なJSONで指定してください",
        );
    }
};

categoriesApp.get("/", async (c) => {
    try {
        return c.json(await listCategories(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

categoriesApp.get("/:id", async (c) => {
    try {
        return c.json(await getCategory(c.env.DB, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

categoriesApp.post("/", async (c) => {
    try {
        return c.json(await createCategory(c.env.DB, await parseJson(c)), 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

categoriesApp.patch("/:id", async (c) => {
    try {
        return c.json(
            await updateCategory(
                c.env.DB,
                c.req.param("id"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

categoriesApp.delete("/:id", async (c) => {
    try {
        await removeCategory(c.env.DB, c.req.param("id"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default categoriesApp;
