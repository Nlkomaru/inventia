import { newId } from "../domain/id";
import type {
    ItemCreateInput,
    ItemListQuery,
    ItemUpdateInput,
} from "../domain/item";

export interface ItemRow {
    id: string;
    name: string;
    categoryId: string;
    locationId: string;
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
    currentQuantity: number;
    expiryDate: string | null;
    lowStockThreshold: number | null;
    memo: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ItemListResult {
    items: ItemRow[];
    nextCursor: string | null;
}

export interface ResolvedItemCreateInput
    extends Omit<
        ItemCreateInput,
        "baseUnit" | "baseDimension" | "currentQuantity"
    > {
    baseUnit: string;
    baseDimension: "mass" | "volume" | "count";
    currentQuantity: number;
}

export class InvalidItemCursorError extends Error {
    constructor() {
        super("invalid cursor");
        this.name = "InvalidItemCursorError";
    }
}

type Cursor = { name: string; id: string };

const encodeCursor = (cursor: Cursor): string =>
    btoa(encodeURIComponent(JSON.stringify(cursor)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");

const decodeCursor = (value: string): Cursor => {
    try {
        const padded = value.replaceAll("-", "+").replaceAll("_", "/");
        const decoded = decodeURIComponent(atob(padded));
        const parsed: unknown = JSON.parse(decoded);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            typeof (parsed as Cursor).name !== "string" ||
            typeof (parsed as Cursor).id !== "string" ||
            (parsed as Cursor).name.length === 0 ||
            (parsed as Cursor).id.length === 0
        ) {
            throw new Error("invalid cursor");
        }
        return parsed as Cursor;
    } catch {
        throw new InvalidItemCursorError();
    }
};

const escapeLike = (value: string): string =>
    value
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");

export const getItem = async (
    db: D1Database,
    id: string,
): Promise<ItemRow | null> =>
    db
        .prepare(
            `SELECT id, name, category_id AS categoryId, location_id AS locationId,
				base_unit AS baseUnit, base_dimension AS baseDimension,
				current_quantity AS currentQuantity, expiry_date AS expiryDate,
				low_stock_threshold AS lowStockThreshold, memo,
				created_at AS createdAt, updated_at AS updatedAt
			 FROM items WHERE id = ?`,
        )
        .bind(id)
        .first<ItemRow>();

export const listItems = async (
    db: D1Database,
    query: ItemListQuery,
): Promise<ItemListResult> => {
    const where: string[] = [];
    const bindings: unknown[] = [];

    if (query.q) {
        where.push("name LIKE ? ESCAPE char(92) COLLATE NOCASE");
        bindings.push(`%${escapeLike(query.q)}%`);
    }
    if (query.categoryId) {
        where.push("category_id = ?");
        bindings.push(query.categoryId);
    }
    if (query.locationId) {
        where.push("location_id = ?");
        bindings.push(query.locationId);
    }
    if (query.lowStockOnly) {
        where.push(
            "low_stock_threshold IS NOT NULL AND current_quantity <= low_stock_threshold",
        );
    }
    if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        where.push(
            "(name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND id > ?))",
        );
        bindings.push(cursor.name, cursor.name, cursor.id);
    }

    const limit = query.limit;
    const sql = `SELECT id, name, category_id AS categoryId, location_id AS locationId,
		base_unit AS baseUnit, base_dimension AS baseDimension,
		current_quantity AS currentQuantity, expiry_date AS expiryDate,
		low_stock_threshold AS lowStockThreshold, memo,
		created_at AS createdAt, updated_at AS updatedAt
		FROM items${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}
		ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT ?`;
    const result = await db
        .prepare(sql)
        .bind(...bindings, limit + 1)
        .all<ItemRow>();
    const rows = result.results;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
        items,
        nextCursor:
            hasMore && last
                ? encodeCursor({ name: last.name, id: last.id })
                : null,
    };
};

export const getCategoryKind = async (
    db: D1Database,
    categoryId: string,
): Promise<"daily_goods" | "food" | "book" | "document" | null> => {
    const result = await db
        .prepare(
            `WITH RECURSIVE ancestors(id, parent_id, kind, depth) AS (
				SELECT id, parent_id, kind, 0 FROM categories WHERE id = ?
				UNION ALL
				SELECT categories.id, categories.parent_id, categories.kind, ancestors.depth + 1
				FROM categories JOIN ancestors ON categories.id = ancestors.parent_id
			)
			SELECT kind FROM ancestors
			WHERE kind IS NOT NULL ORDER BY depth ASC LIMIT 1`,
        )
        .bind(categoryId)
        .first<{ kind: "daily_goods" | "food" | "book" | "document" }>();
    return result?.kind ?? null;
};

export const categoryExists = async (
    db: D1Database,
    categoryId: string,
): Promise<boolean> =>
    Boolean(
        await db
            .prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
            .bind(categoryId)
            .first<{ id: string }>(),
    );

export const locationExists = async (
    db: D1Database,
    locationId: string,
): Promise<boolean> =>
    Boolean(
        await db
            .prepare("SELECT id FROM storage_locations WHERE id = ? LIMIT 1")
            .bind(locationId)
            .first<{ id: string }>(),
    );

export const createItem = async (
    db: D1Database,
    input: ResolvedItemCreateInput,
): Promise<ItemRow> => {
    const id = newId();
    const now = new Date().toISOString();
    const itemStatement = db
        .prepare(
            `INSERT INTO items
				(id, name, category_id, location_id, base_unit, base_dimension,
				 current_quantity, expiry_date, low_stock_threshold, memo, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            input.name,
            input.categoryId,
            input.locationId,
            input.baseUnit,
            input.baseDimension,
            input.currentQuantity,
            input.expiryDate ?? null,
            input.lowStockThreshold ?? null,
            input.memo ?? null,
            now,
            now,
        );
    const statements: D1PreparedStatement[] = [itemStatement];
    if (input.currentQuantity > 0) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO stock_movements
						(id, item_id, delta, reason, purchase_id, occurred_at, idempotency_key, created_at)
					 VALUES (?, ?, ?, 'stocktake', NULL, ?, NULL, ?)`,
                )
                .bind(newId(), id, input.currentQuantity, now, now),
        );
    }
    await db.batch(statements);
    const created = await getItem(db, id);
    if (!created) {
        throw new Error("created item could not be read");
    }
    return created;
};

export const updateItem = async (
    db: D1Database,
    id: string,
    input: ItemUpdateInput,
): Promise<ItemRow | null> => {
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    const fields: Array<[keyof typeof input, string]> = [
        ["name", "name"],
        ["categoryId", "category_id"],
        ["locationId", "location_id"],
        ["expiryDate", "expiry_date"],
        ["lowStockThreshold", "low_stock_threshold"],
        ["memo", "memo"],
    ];
    for (const [key, column] of fields) {
        if (input[key] !== undefined) {
            assignments.push(`${column} = ?`);
            bindings.push(input[key] ?? null);
        }
    }
    if (assignments.length === 0) {
        return getItem(db, id);
    }
    assignments.push("updated_at = ?");
    bindings.push(new Date().toISOString(), id);
    await db
        .prepare(`UPDATE items SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...bindings)
        .run();
    return getItem(db, id);
};

export const deleteItem = async (
    db: D1Database,
    id: string,
): Promise<boolean> => {
    const result = await db
        .prepare("DELETE FROM items WHERE id = ?")
        .bind(id)
        .run();
    return (result.meta.changes ?? 0) > 0;
};
