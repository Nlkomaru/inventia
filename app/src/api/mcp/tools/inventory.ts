import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    bookReadingListDtoSchema,
    itemBatchIdsMax,
    itemBatchInputSchema,
    itemBatchOutputSchema,
    itemDetailDtoSchema,
    itemDtoSchema,
    itemListQuerySchema,
    itemNameMatchInputSchema,
    itemNameMatchNamesMax,
    itemNameMatchOutputSchema,
    itemSemanticSearchQuerySchema,
    itemSemanticSearchResultSchema,
} from "../../../domain/item";
import {
    priceBatchInputSchema,
    priceBatchItemIdsMax,
    priceBatchOutputSchema,
    priceComparisonListInputSchema,
    priceRecordListInputSchema,
    priceRecordListOutputSchema,
} from "../../../domain/price";
import { bookReadingListQuerySchema } from "../../../domain/reading";
import {
    staleStocktakeListDtoSchema,
    staleStocktakeQuerySchema,
} from "../../../domain/stock";
import { EmbeddingServiceError } from "../../../services/embeddingService";
import { matchItemNames } from "../../../services/itemMatchService";
import {
    type ItemSearchEnv,
    searchItemsByVector,
} from "../../../services/itemSearchService";
import {
    getItem,
    getItems,
    ItemServiceError,
    listItems,
} from "../../../services/itemService";
import {
    compareUnitPrices,
    compareUnitPricesForItems,
    listPriceRecords,
    listPriceRecordsForItems,
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
    .pick({
        categoryId: true,
        locationId: true,
        sort: true,
        limit: true,
        cursor: true,
    })
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

const semanticSearchError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof EmbeddingServiceError
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

// search_inventory_semantic は itemSearchService.searchItemsByVector を呼ぶため、
// D1Database だけでなく VECTORIZE と SETTINGS_ENCRYPTION_KEY も要る。この登録関数を
// ItemSearchEnv で受け、他の tool へは env.DB を渡す
export const registerInventoryTools = (
    server: McpServer,
    env: ItemSearchEnv,
): void => {
    const db = env.DB;
    server.registerTool(
        "search_inventory",
        {
            title: "Search inventory",
            description:
                "Search inventory item names and filter by category, storage location, low-stock state, expiry within a number of days (expiringWithinDays), or stored reading state (readingStatus: unread, reading, or finished). readingStatus matches stored reading states only, so an item without a stored reading state never matches any value and an unset state is not treated as unread. Each item carries its total quantity, its readingStatus (null when no reading state is stored for it), plus the expiry summary of its lots: earliestExpiryDate is the earliest expiry among lots that still have stock (null when none of them has an expiry date) and lotCount is how many lots have stock. Use get_inventory_items for the per-expiry lot breakdown of several rows in one call. Results are ordered by item name unless sort is expiry, which orders by the soonest expiry with items that have none last; return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue — a cursor belongs to the sort it was made with and is rejected when replayed under the other one.",
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
        "resolve_inventory_items",
        {
            title: "Resolve printed names to inventory items",
            description: `Match up to ${itemNameMatchNamesMax} product names against existing items in one call, so a caller reading a receipt or a shopping list does not have to search once per line. Names are normalised the same way the item alias dictionary is (NFKC, case-folded, spaces and symbols dropped), so half-width katakana and full-width digits match their counterparts. A result is confirmed only by an exact item-name match (method exact) or by the alias dictionary (method alias); otherwise itemId is null and candidates carries the closest names by similarity, ranked, for the caller to choose from — similarity alone never confirms an item. candidateLimit trims those suggestions and 0 returns confirmed matches only. results has one entry per input name, in the same order, so a repeated name comes back as repeated entries and the caller can zip the results onto its own lines. poolTruncated is true when there are more items than the matcher reads, in which case a null itemId is not evidence that no such item exists. This tool only reads data.`,
            inputSchema: itemNameMatchInputSchema,
            outputSchema: itemNameMatchOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await matchItemNames(db, input));
            } catch (error) {
                return inventoryError(error, "inventory name matching failed");
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
        "get_inventory_items",
        {
            title: "Get several inventory items",
            description: `Read up to ${itemBatchIdsMax} items by id in one call, so a caller holding a page of search results does not have to call get_inventory_item once per row. items comes back in the order the ids were given, duplicates removed, and ids that do not exist are listed in notFound instead of failing the whole call. includeLots defaults to true and carries the per-expiry lot breakdown; set it to false when only the summary is needed — lots is then empty while lotCount and earliestExpiryDate still describe the lots that have stock. This tool only reads data.`,
            inputSchema: itemBatchInputSchema,
            outputSchema: itemBatchOutputSchema,
        },
        async ({ ids, includeLots }) => {
            try {
                return mcpSuccess(await getItems(db, ids, { includeLots }));
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
                "List inventory items that hold stock in a lot expiring within withinDays days from now, optionally narrowed to one category or storage location. Lots without an expiry date never match and already expired lots always match. Each item reports earliestExpiryDate and lotCount only; call get_inventory_items for the per-expiry lot breakdown of a whole page in one call. sort defaults to name; pass expiry to get the soonest expiry first, which makes the first page the answer instead of requiring every page to be read and sorted. Results return at most limit items (default 50, maximum 100), and pass nextCursor back as cursor to continue — a cursor belongs to the sort it was made with and is rejected when replayed under the other one.",
            inputSchema: expiringInventoryInputSchema,
            outputSchema: itemListOutputSchema,
        },
        async ({ withinDays, categoryId, locationId, sort, limit, cursor }) => {
            try {
                return mcpSuccess(
                    await listItems(db, {
                        expiringWithinDays: withinDays,
                        categoryId,
                        locationId,
                        sort,
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
        "search_inventory_semantic",
        {
            title: "Search inventory by meaning",
            description:
                "Finds inventory items whose stored name is semantically similar to the query, using a vector index built from item names. This is a supplement to search_inventory's exact/partial name match, not a replacement: it can find items even when the query uses different wording, but only items that have been indexed can be returned. Indexing runs best-effort whenever an item is created or updated, so an item can be missing from the index (and therefore from these results) when the OpenRouter API key was not configured or the indexing call failed; the item-reindexing endpoint recovers from that by rebuilding the index for every item. There is no cursor: results are cut off at topK (default 20, maximum 100) because the underlying vector query has no paging.",
            inputSchema: itemSemanticSearchQuerySchema,
            outputSchema: itemSemanticSearchResultSchema,
        },
        async ({ q, topK }) => {
            try {
                const items = await searchItemsByVector(env, q, { topK });
                return mcpSuccess({ items });
            } catch (error) {
                return semanticSearchError(
                    error,
                    "semantic inventory search failed",
                );
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
        "get_price_histories",
        {
            title: "Get price history for several items",
            description: `Read the most recent price records for up to ${priceBatchItemIdsMax} items in one call, newest first, so comparing candidates does not cost one call per item. limitPerItem caps the records returned for each item (default 5) and truncated says that item has older records; read them with get_price_history, which is the paged path. Items with no pricing context are listed in notFound instead of failing the whole call. This tool only reads data.`,
            inputSchema: priceBatchInputSchema,
            outputSchema: priceBatchOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listPriceRecordsForItems(db, input));
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
                "Get up to 100 price records for one item, sorted by unit price in ascending order (default 100). Unit price is the price per base unit, so records with different content amounts or set counts are comparable. Pass nextCursor as cursor to continue when more records are available; to rank across several items use compare_unit_prices_across_items.",
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

    server.registerTool(
        "compare_unit_prices_across_items",
        {
            title: "Compare unit prices across items",
            description: `Read the cheapest price records by unit price for up to ${priceBatchItemIdsMax} items in one call, so a caller can rank candidates against each other without calling compare_unit_prices per item. Each item's records are sorted by unit price ascending and capped by limitPerItem (default 5); truncated says that item has more records, which compare_unit_prices returns with paging. Ranking across items is left to the caller, since which unit is comparable depends on the items. Items with no pricing context are listed in notFound. This tool only reads data.`,
            inputSchema: priceBatchInputSchema,
            outputSchema: priceBatchOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await compareUnitPricesForItems(db, input));
            } catch (error) {
                return priceError(error, "unit price comparison failed");
            }
        },
    );
};
