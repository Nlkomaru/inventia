import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    categoryDtoSchema,
    categoryIdSchema,
    categoryListInputSchema,
    categoryListOutputSchema,
    categoryTreeOutputSchema,
} from "../../../domain/category";
import {
    CategoryServiceError,
    categoryTreeMaxSize,
    getCategory,
    listCategories,
    listCategoryTree,
} from "../../../services/categoryService";
import { mcpError, mcpSuccess } from "../result";

const categoryIdInputSchema = z.object({ id: categoryIdSchema }).strict();

const categoryError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof CategoryServiceError
            ? `${error.code}: ${error.message}`
            : `CATEGORY_INTERNAL: ${fallback}`,
    );

export const registerCategoryTools = (
    server: McpServer,
    db: D1Database,
): void => {
    server.registerTool(
        "list_categories",
        {
            title: "List categories",
            description:
                "List one level of the category tree, ordered by sortOrder then by id. parentId selects the level and null lists the root categories. Results return at most limit categories (default 50, maximum 100), and pass nextCursor back as cursor to continue; a cursor is only valid for the parentId it was made with, and reusing it with a different parentId is rejected as an invalid cursor. A category whose kind is null is generic, and its effective kind is resolved by walking up its ancestors.",
            inputSchema: categoryListInputSchema,
            outputSchema: categoryListOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listCategories(db, input));
            } catch (error) {
                return categoryError(error, "category listing failed");
            }
        },
    );

    server.registerTool(
        "list_category_tree",
        {
            title: "List the whole category tree",
            description: `Return every category in one call, ordered by sortOrder then by id, so a caller does not have to walk the tree one level at a time with list_categories. Each item carries its parentId, which is enough to rebuild the hierarchy and to resolve an effective kind by following ancestors. At most ${categoryTreeMaxSize} categories are returned and truncated is true when there are more; there is no cursor for the rest, so fall back to list_categories per level in that case. This tool only reads data.`,
            inputSchema: z.object({}).strict(),
            outputSchema: categoryTreeOutputSchema,
        },
        async () => {
            try {
                return mcpSuccess(await listCategoryTree(db));
            } catch (error) {
                return categoryError(error, "category tree listing failed");
            }
        },
    );

    server.registerTool(
        "get_category",
        {
            title: "Get category",
            description:
                "Get one category by its system ID. To resolve several categories, or to follow a category's ancestors (needed when kind is null), read the whole tree once with list_category_tree instead of calling this per id.",
            inputSchema: categoryIdInputSchema,
            outputSchema: categoryDtoSchema,
        },
        async ({ id }) => {
            try {
                return mcpSuccess(await getCategory(db, id));
            } catch (error) {
                return categoryError(error, "category lookup failed");
            }
        },
    );
};
