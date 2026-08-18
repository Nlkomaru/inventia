import type {
    CategoryCursor,
    CategoryId,
    CategoryKind,
    CategoryUpdateInput,
} from "../domain/category";

export interface CategoryRecord {
    id: string;
    name: string;
    parentId: string | null;
    kind: CategoryKind | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface CategoryListQuery {
    parentId: CategoryId | null;
    limit: number;
    cursor: CategoryCursor | null;
}

export interface CategoryListResult {
    rows: CategoryRecord[];
    hasMore: boolean;
}

export interface NewCategoryRecord {
    id: string;
    name: string;
    parentId: string | null;
    kind: CategoryKind | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

interface CategorySelectRow {
    id: string;
    name: string;
    parentId: string | null;
    kind: CategoryKind | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

const categorySelect = `
	SELECT
		id,
		name,
		parent_id AS parentId,
		kind,
		sort_order AS sortOrder,
		created_at AS createdAt,
		updated_at AS updatedAt
	FROM categories`;

const toCategoryRecord = (row: CategorySelectRow): CategoryRecord => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

export const listCategories = async (
    db: D1Database,
    query: CategoryListQuery,
): Promise<CategoryListResult> => {
    const statement = db
        .prepare(
            `${categorySelect}
			WHERE ((?1 IS NULL AND parent_id IS NULL) OR parent_id = ?1)
				AND (
					?2 IS NULL
					OR sort_order > ?2
					OR (sort_order = ?2 AND id > ?3)
				)
			ORDER BY sort_order ASC, id ASC
			LIMIT ?4`,
        )
        .bind(
            query.parentId,
            query.cursor?.sortOrder ?? null,
            query.cursor?.id ?? null,
            query.limit + 1,
        );
    const result = await statement.all<CategorySelectRow>();
    const rows = result.results.map(toCategoryRecord);
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

/** Reads the whole tree in one round trip; the caller rebuilds the levels from parentId. */
export const listAllCategories = async (
    db: D1Database,
    limit: number,
): Promise<CategoryListResult> => {
    const result = await db
        .prepare(
            `${categorySelect}
			ORDER BY sort_order ASC, id ASC
			LIMIT ?1`,
        )
        .bind(limit + 1)
        .all<CategorySelectRow>();
    const rows = result.results.map(toCategoryRecord);
    return {
        rows: rows.slice(0, limit),
        hasMore: rows.length > limit,
    };
};

export const findCategoryById = async (
    db: D1Database,
    id: CategoryId,
): Promise<CategoryRecord | null> => {
    const row = await db
        .prepare(`${categorySelect} WHERE id = ?1 LIMIT 1`)
        .bind(id)
        .first<CategorySelectRow>();
    return row ? toCategoryRecord(row) : null;
};

/** Handles NULL parent_id explicitly because SQLite NULLs are not equal. */
export const findSiblingByName = async (
    db: D1Database,
    parentId: CategoryId | null,
    name: string,
    excludeId?: CategoryId,
): Promise<CategoryRecord | null> => {
    const row = await db
        .prepare(
            `${categorySelect}
			WHERE ((parent_id IS NULL AND ?1 IS NULL) OR parent_id = ?1)
				AND name = ?2
				AND (?3 IS NULL OR id <> ?3)
			LIMIT 1`,
        )
        .bind(parentId, name, excludeId ?? null)
        .first<CategorySelectRow>();
    return row ? toCategoryRecord(row) : null;
};

export const parentExists = async (
    db: D1Database,
    parentId: CategoryId,
): Promise<boolean> => {
    const row = await db
        .prepare("SELECT 1 AS present FROM categories WHERE id = ?1 LIMIT 1")
        .bind(parentId)
        .first<{ present: number }>();
    return row !== null;
};

/** Checks descendants in arbitrary-depth trees using a recursive CTE. */
export const hasDescendant = async (
    db: D1Database,
    ancestorId: CategoryId,
    candidateId: CategoryId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            `WITH RECURSIVE descendants(id) AS (
				SELECT id FROM categories WHERE parent_id = ?1
				UNION
				SELECT child.id
				FROM categories AS child
				INNER JOIN descendants AS d ON child.parent_id = d.id
			)
			SELECT 1 AS present FROM descendants WHERE id = ?2 LIMIT 1`,
        )
        .bind(ancestorId, candidateId)
        .first<{ present: number }>();
    return row !== null;
};

export const hasChildren = async (
    db: D1Database,
    parentId: CategoryId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            "SELECT 1 AS present FROM categories WHERE parent_id = ?1 LIMIT 1",
        )
        .bind(parentId)
        .first<{ present: number }>();
    return row !== null;
};

/** Items have an ON DELETE RESTRICT foreign key to categories. */
export const hasReferencingItems = async (
    db: D1Database,
    categoryId: CategoryId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            "SELECT 1 AS present FROM items WHERE category_id = ?1 LIMIT 1",
        )
        .bind(categoryId)
        .first<{ present: number }>();
    return row !== null;
};

export const insertCategory = async (
    db: D1Database,
    record: NewCategoryRecord,
): Promise<CategoryRecord> => {
    await db
        .prepare(
            `INSERT INTO categories
				(id, name, parent_id, kind, sort_order, created_at, updated_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
            record.id,
            record.name,
            record.parentId,
            record.kind,
            record.sortOrder,
            record.createdAt,
            record.updatedAt,
        )
        .run();
    const inserted = await findCategoryById(db, record.id);
    if (!inserted) {
        throw new Error("Inserted category could not be read back");
    }
    return inserted;
};

export const updateCategory = async (
    db: D1Database,
    id: CategoryId,
    changes: CategoryUpdateInput,
    updatedAt: string,
): Promise<CategoryRecord> => {
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (changes.name !== undefined) {
        assignments.push("name = ?");
        values.push(changes.name);
    }
    if (changes.parentId !== undefined) {
        assignments.push("parent_id = ?");
        values.push(changes.parentId);
    }
    if (changes.kind !== undefined) {
        assignments.push("kind = ?");
        values.push(changes.kind);
    }
    if (changes.sortOrder !== undefined) {
        assignments.push("sort_order = ?");
        values.push(changes.sortOrder);
    }
    assignments.push("updated_at = ?");
    values.push(updatedAt, id);

    await db
        .prepare(
            `UPDATE categories
			SET ${assignments.join(", ")}
			WHERE id = ?`,
        )
        .bind(...values)
        .run();
    const updated = await findCategoryById(db, id);
    if (!updated) {
        throw new Error("Updated category could not be read back");
    }
    return updated;
};

export const deleteCategory = async (
    db: D1Database,
    id: CategoryId,
): Promise<void> => {
    await db.prepare("DELETE FROM categories WHERE id = ?1").bind(id).run();
};
