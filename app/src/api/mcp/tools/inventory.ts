import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    bookReadingListDtoSchema,
    itemDetailDtoSchema,
    itemDtoSchema,
    itemListQuerySchema,
} from "../../../domain/item";
import {
    priceComparisonListInputSchema,
    priceRecordListInputSchema,
    priceRecordListOutputSchema,
} from "../../../domain/price";
import { bookReadingListQuerySchema } from "../../../domain/reading";
import {
    staleStocktakeListDtoSchema,
    staleStocktakeQuerySchema,
} from "../../../domain/stock";
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
import {
    listBookReadingStates,
    ReadingServiceError,
} from "../../../services/readingService";
import {
    listStaleStocktakeItems,
    StockServiceError,
} from "../../../services/stockService";
import { mcpError, mcpSuccess } from "../result";

const itemListOutputSchema = z.object({
    items: z.array(itemDtoSchema),
    nextCursor: z.string().nullable(),
});

// 期限接近の絞り込みだけを必須にした一覧入力。limit と cursor の意味を
// search_inventory と揃えるため itemListQuerySchema から取り、範囲を二重に定義しない
const expiringInventoryInputSchema = itemListQuerySchema
    .pick({ limit: true, cursor: true })
    .extend({
        withinDays: itemListQuerySchema.shape.expiringWithinDays.unwrap(),
    })
    .strict();

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

const readingError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof ReadingServiceError
            ? `${error.code}: ${error.message}`
            : `INTERNAL_ERROR: ${fallback}`,
    );

const stockError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof StockServiceError
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
                "Search inventory item names and filter by category, storage location, low-stock state, expiry within a number of days (expiringWithinDays), or stored reading state (readingStatus: unread, reading, or finished). readingStatus matches stored reading states only, so an item without a stored reading state never matches any value and an unset state is not treated as unread. Each item carries its total quantity, its readingStatus (null when no reading state is stored for it), plus the expiry summary of its lots: earliestExpiryDate is the earliest expiry among lots that still have stock (null when none of them has an expiry date) and lotCount is how many lots have stock. Use get_inventory_item for the per-expiry lot breakdown. Results are ordered by item name, return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue.",
            inputSchema: itemListQuerySchema,
            outputSchema: itemListOutputSchema,
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
                "Get one inventory item by its system ID, including its base unit, total quantity, low-stock threshold, the expiry-lot breakdown, and its reading state. lots lists one entry per expiry date in FEFO order (earliest expiry first, the lot without an expiry date last); lots holding no stock are omitted, and currentQuantity is maintained as the sum of the item's lot quantities. readingStatus and readingState report the stored reading state, where readingState also carries startedAt and finishedAt; both are null when no reading state is stored for the item. The storage location is a property of the item, not of a lot.",
            inputSchema: z.object({ id: z.string().min(1) }),
            outputSchema: itemDetailDtoSchema,
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
        "list_expiring_inventory",
        {
            title: "List expiring inventory",
            description:
                "List inventory items that hold stock in a lot expiring within withinDays days from now. Lots without an expiry date never match and already expired lots always match. Each item reports earliestExpiryDate and lotCount only; call get_inventory_item for the per-expiry lot breakdown. Results are ordered by item name rather than by expiry, return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue.",
            inputSchema: expiringInventoryInputSchema,
            outputSchema: itemListOutputSchema,
        },
        async ({ withinDays, limit, cursor }) => {
            try {
                return mcpSuccess(
                    await listItems(db, {
                        expiringWithinDays: withinDays,
                        limit,
                        cursor,
                    }),
                );
            } catch (error) {
                return inventoryError(
                    error,
                    "expiring inventory listing failed",
                );
            }
        },
    );

    server.registerTool(
        "list_book_reading_status",
        {
            title: "List book reading status",
            description:
                "List the inventory items that belong to a book category together with their reading state. Each item carries readingStatus plus readingState, which adds startedAt and finishedAt; both are null when no reading state is stored for that item, so books that were never marked are still listed. The optional status filter (unread, reading, or finished) matches stored reading states only, so a book without a stored state never matches any value and an unset state is not treated as unread. Results are ordered by item name, return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue.",
            inputSchema: bookReadingListQuerySchema,
            outputSchema: bookReadingListDtoSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listBookReadingStates(db, input));
            } catch (error) {
                return readingError(
                    error,
                    "book reading status listing failed",
                );
            }
        },
    );

    server.registerTool(
        "list_stale_stocktake_items",
        {
            title: "List items whose stocktake is stale",
            description:
                "List the inventory items that have not been counted recently, so they can be scheduled for a stocktake. This tool only reads data and changes no stock. An item qualifies when its most recent stocktake happened strictly earlier than staleAfterDays days before now, or when the item was never counted at all; lastStocktakeAt reports that timestamp and is null for an item that was never counted. A stocktake that confirmed the recorded quantity counts as a count even though it records no stock movement. staleAfterDays 0 therefore returns every item whose last count is in the past plus every item that was never counted. Creating an item with an initial quantity records a stocktake movement, so a newly created item counts as just stocktaken. Results are ordered never-counted first, then by lastStocktakeAt ascending with the item ID breaking ties, return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue, which is only valid for the same staleAfterDays.",
            inputSchema: staleStocktakeQuerySchema,
            outputSchema: staleStocktakeListDtoSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listStaleStocktakeItems(db, input));
            } catch (error) {
                return stockError(error, "stale stocktake listing failed");
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
