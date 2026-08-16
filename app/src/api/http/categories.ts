import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
    categoryListInputSchema,
    categoryListOutputSchema,
} from "../../domain/category";
import {
    CategoryServiceError,
    listCategories,
} from "../../services/categoryService";
import type { ApiBindings } from "../bindings";

type CategoriesContext = Context<ApiBindings>;

export const categoriesApp = new OpenAPIHono<ApiBindings>();

const categoryErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});

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

const errorResponse = (c: CategoriesContext, error: unknown): Response => {
    if (error instanceof CategoryServiceError) {
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
                message: "内部エラーが発生しました",
            },
        },
        500,
    );
};

categoriesApp.get("/", async (c) => {
    try {
        return c.json(await listCategories(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default categoriesApp;
