import type {
    CategoryCursor,
    CategoryId,
    CategoryKind,
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
