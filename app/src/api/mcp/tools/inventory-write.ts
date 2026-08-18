import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    itemCreateSchema,
    itemDtoSchema,
    itemUpdateSchema,
} from "../../../domain/item";
import { itemLotListDtoSchema, lotUpdateSchema } from "../../../domain/lot";
import {
    readingStateDtoSchema,
    readingStateUpsertSchema,
} from "../../../domain/reading";
import {
    stockAdjustmentSchema,
    stockOperationResultSchema,
    stocktakeSchema,
} from "../../../domain/stock";
import {
    type ItemSearchEnv,
    indexItem,
} from "../../../services/itemSearchService";
import {
    createItem,
    ItemServiceError,
    updateItem,
} from "../../../services/itemService";
import {
    LotServiceError,
    updateLotExpiryDate,
} from "../../../services/lotService";
import {
    ReadingServiceError,
    setReadingState,
} from "../../../services/readingService";
import {
    adjustStock,
    StockServiceError,
    stocktake,
} from "../../../services/stockService";
import { mcpError, mcpSuccess } from "../result";

// ドメインに id 用のスキーマが無いため、HTTP のパスパラメータと同じ制約を置く。
// service 側でも trim と空文字の検証を行うので、ここは入力書式の門番だけを担う
const itemIdInputSchema = z.string().trim().min(1).max(128);
const lotIdInputSchema = z.string().trim().min(1).max(128);

// 更新対象の id は入力に足すだけで、更新できるフィールドはドメインの定義に従う。
// id があるため「1 つ以上のフィールドが必要」という制約はここでは成立せず、
// service の再検証が VALIDATION_ERROR として返す
const itemUpdateInputSchema = itemUpdateSchema.extend({
    id: itemIdInputSchema,
});

const stockAdjustmentInputSchema = stockAdjustmentSchema.extend({
    itemId: itemIdInputSchema,
});

const stocktakeInputSchema = stocktakeSchema.extend({
    itemId: itemIdInputSchema,
});

const lotExpiryCorrectionInputSchema = lotUpdateSchema.extend({
    itemId: itemIdInputSchema,
    lotId: lotIdInputSchema,
});

const readingStatusInputSchema = readingStateUpsertSchema.extend({
    itemId: itemIdInputSchema,
});

// 業務エラーは service のコードと文言だけを返し、内部例外や SQL を利用者へ渡さない
const serviceError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof ItemServiceError ||
            error instanceof StockServiceError ||
            error instanceof LotServiceError ||
            error instanceof ReadingServiceError
            ? `${error.code}: ${error.message}`
            : `INTERNAL_ERROR: ${fallback}`,
    );

// create_inventory_item / update_inventory_item は品目作成・更新後に
// itemSearchService の indexItem を呼ぶ。indexItem は best-effort（内部で例外を
// 握り潰す）なので、失敗しても tool 自体は成功を返す。tool handler には
// waitUntil に相当する実行コンテキストが無いため、応答を返す前に await する
export const registerInventoryWriteTools = (
    server: McpServer,
    env: ItemSearchEnv,
): void => {
    const db = env.DB;
    server.registerTool(
        "create_inventory_item",
        {
            title: "Create inventory item",
            description:
                "Creates a new inventory item row, and when currentQuantity is positive or expiryDate is given also its initial expiry lot, plus an immutable stocktake movement with that lot's allocation whenever currentQuantity is positive. name, categoryId, and locationId are required. baseUnit and baseDimension must be sent together; they may be omitted only for document categories, which default to counting pieces. An omitted currentQuantity is 0 except for document categories, where it defaults to 1, so a document created without a quantity already gets that initial lot and stocktake movement and counts as just stocktaken; send currentQuantity 0 to create one holding no stock. expiryDate is the expiry date of the initial lot, and omitting it or sending null puts the initial quantity into the lot without an expiry date. Change quantities afterwards with adjust_inventory_stock or stocktake_inventory_item, and expiry dates with correct_inventory_lot_expiry.",
            inputSchema: itemCreateSchema,
            outputSchema: itemDtoSchema,
        },
        async (input) => {
            try {
                const created = await createItem(db, input);
                await indexItem(env, created.id);
                return mcpSuccess(created);
            } catch (error) {
                return serviceError(error, "inventory item creation failed");
            }
        },
    );

    server.registerTool(
        "update_inventory_item",
        {
            title: "Update inventory item",
            description:
                "Overwrites the display metadata of the existing item named by id; the fields you send replace the stored values and the fields you omit stay unchanged. At least one of name, categoryId, locationId, lowStockThreshold, or memo is required. Base unit, stock quantity, and lot expiry dates cannot be changed here: use adjust_inventory_stock or stocktake_inventory_item for quantities and correct_inventory_lot_expiry for expiry dates. An item cannot move across the document and non-document category boundary, and an item that holds a reading state cannot leave its book category until that reading state is removed.",
            inputSchema: itemUpdateInputSchema,
            outputSchema: itemDtoSchema,
        },
        async ({ id, ...fields }) => {
            try {
                const updated = await updateItem(db, id, fields);
                // 埋め込み対象は品目名だけなので、name を送っていない更新では索引を触らない
                if (fields.name !== undefined) {
                    await indexItem(env, updated.id);
                }
                return mcpSuccess(updated);
            } catch (error) {
                return serviceError(error, "inventory item update failed");
            }
        },
    );

    server.registerTool(
        "adjust_inventory_stock",
        {
            title: "Adjust inventory stock",
            description:
                "Applies a signed stock delta to the item's expiry lots: lot quantities change, an immutable stock movement with its per-lot allocations is recorded, and the item's total quantity is recomputed from the lots. delta must not be 0 and reason states why the stock moved. A positive delta is added to the lot with the given expiryDate and creates that lot when it does not exist yet; omitting expiryDate or sending null targets the lot without an expiry date. A negative delta is taken from the lot named by lotId or expiryDate, and omitting both consumes lots in FEFO order (earliest expiry first, the lot without an expiry date last). lotId and expiryDate cannot be sent together. idempotencyKey is required because this operation is not repeatable: retrying with the same key and the same request returns the already stored operation with replayed true instead of applying the delta twice, while the same key with a different request is rejected as a conflict rather than overwriting the stored operation.",
            inputSchema: stockAdjustmentInputSchema,
            outputSchema: stockOperationResultSchema,
        },
        async ({ itemId, ...adjustment }) => {
            try {
                return mcpSuccess(await adjustStock(db, itemId, adjustment));
            } catch (error) {
                return serviceError(error, "stock adjustment failed");
            }
        },
    );

    server.registerTool(
        "stocktake_inventory_item",
        {
            title: "Record inventory stocktake",
            description:
                "Confirms a counted stock state as absolute quantities: the counted lots are set to the given numbers, lots missing from the request become 0, the item's total quantity is recomputed from the lots, and a stock movement with reason stocktake plus its per-lot allocations is recorded whenever anything moved. Send lots to confirm the quantity of every expiry date, with each expiry date appearing only once, or quantity to confirm the item total; exactly one of the two is required. quantity is rejected when the item holds stock in more than one lot, because splitting a total across expiry dates cannot be inferred, so send lots instead. A count that changes nothing records no movement and returns movement as null. idempotencyKey is required because this operation is not repeatable: retrying with the same key and the same request returns the already stored operation with replayed true instead of counting twice, while the same key with a different request is rejected as a conflict rather than overwriting the stored operation.",
            inputSchema: stocktakeInputSchema,
            outputSchema: stockOperationResultSchema,
        },
        async ({ itemId, ...count }) => {
            try {
                return mcpSuccess(await stocktake(db, itemId, count));
            } catch (error) {
                return serviceError(error, "stocktake failed");
            }
        },
    );

    server.registerTool(
        "correct_inventory_lot_expiry",
        {
            title: "Correct inventory lot expiry",
            description:
                "Changes the expiry date of one existing lot of the item, and merges it into the item's other lot when that lot already carries the requested expiry date; the corrected lot then stays as a row with quantity 0 because stock movement allocations reference it. expiryDate is required and accepts null, which turns the lot into the lot without an expiry date. The item's total quantity never changes, so no stock movement is recorded, and past allocations keep the expiry date recorded at the time of the movement. Use adjust_inventory_stock or stocktake_inventory_item to change quantities. Returns the item's lots that hold stock in FEFO order.",
            inputSchema: lotExpiryCorrectionInputSchema,
            outputSchema: itemLotListDtoSchema,
        },
        async ({ itemId, lotId, expiryDate }) => {
            try {
                return mcpSuccess(
                    await updateLotExpiryDate(db, itemId, lotId, {
                        expiryDate,
                    }),
                );
            } catch (error) {
                return serviceError(error, "lot expiry correction failed");
            }
        },
    );

    server.registerTool(
        "set_book_reading_status",
        {
            title: "Set book reading status",
            description:
                "Replaces the stored reading state of one book item with the given status and dates; startedAt and finishedAt are overwritten on every call, so omitting them clears the stored dates. Only items in a book category, including items inheriting that kind from an ancestor category, can hold a reading state; any other item is rejected. status unread requires both dates to be empty, status reading requires finishedAt to be empty, and finishedAt must not be earlier than startedAt. Dates are ISO 8601 date-times with an offset and are stored normalized to UTC. Stock, lots, and movements are not touched.",
            inputSchema: readingStatusInputSchema,
            outputSchema: readingStateDtoSchema,
        },
        async ({ itemId, ...state }) => {
            try {
                return mcpSuccess(await setReadingState(db, itemId, state));
            } catch (error) {
                return serviceError(error, "reading status update failed");
            }
        },
    );
};
