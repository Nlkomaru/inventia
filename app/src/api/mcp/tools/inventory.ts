import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { itemDtoSchema, itemListQuerySchema } from "../../../domain/item";
import {
    getItem,
    ItemServiceError,
    listItems,
} from "../../../services/itemService";
import { mcpError, mcpSuccess } from "../result";

const itemSearchOutputSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});

const inventoryError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof ItemServiceError
            ? `${error.code}: ${error.message}`
            : `INTERNAL_ERROR: ${fallback}`,
    );

export const registerInventoryTools = (
    server: McpServer,
    db: D1Database,
): void => {
    server.registerTool(
        "search_inventory",
        {
            title: "Search inventory",
            description:
                "Search inventory item names and filter by category, storage location, or low-stock state. Results are cursor-paginated and limited to 100 items.",
            inputSchema: itemListQuerySchema,
            outputSchema: itemSearchOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listItems(db, input));
            } catch (error) {
                return inventoryError(error, "inventory search failed");
            }
        },
    );

    server.registerTool(
        "get_inventory_item",
        {
            title: "Get inventory item",
            description:
                "Get one inventory item by its system ID, including its base unit, current quantity, expiry date, and low-stock threshold.",
            inputSchema: z.object({ id: z.string().min(1) }),
            outputSchema: itemDtoSchema,
        },
        async ({ id }) => {
            try {
                return mcpSuccess(await getItem(db, id));
            } catch (error) {
                return inventoryError(error, "inventory item lookup failed");
            }
        },
    );
};
