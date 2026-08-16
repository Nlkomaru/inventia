import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { itemDtoSchema, itemListQuerySchema } from "../../../domain/item";
import {
    priceComparisonListInputSchema,
    priceRecordListInputSchema,
    priceRecordListOutputSchema,
} from "../../../domain/price";
import {
    getItem,
    ItemServiceError,
    listItems,
} from "../../../services/itemService";
import {
    compareUnitPrices,
    listPriceRecords,
    PriceServiceError,
} from "../../../services/priceService";
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

const priceError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof PriceServiceError
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

    server.registerTool(
        "get_price_history",
        {
            title: "Get price history",
            description:
                "Get an inventory item's price history in reverse chronological order with cursor pagination.",
            inputSchema: priceRecordListInputSchema,
            outputSchema: priceRecordListOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listPriceRecords(db, input));
            } catch (error) {
                return priceError(error, "price history lookup failed");
            }
        },
    );

    server.registerTool(
        "compare_unit_prices",
        {
            title: "Compare unit prices",
            description:
                "Get up to 100 price records for one item and base dimension, sorted by unit price in ascending order. Pass nextCursor as cursor to continue when more records are available.",
            inputSchema: priceComparisonListInputSchema,
            outputSchema: priceRecordListOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await compareUnitPrices(db, input));
            } catch (error) {
                return priceError(error, "unit price comparison failed");
            }
        },
    );
};
