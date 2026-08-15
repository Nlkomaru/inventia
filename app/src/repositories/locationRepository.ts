import type {
    LocationCursor,
    LocationId,
    LocationUpdateInput,
} from "../domain/location";

export interface LocationRecord {
    id: string;
    name: string;
    parentId: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

export interface LocationListQuery {
    parentId: LocationId | null;
    limit: number;
    cursor: LocationCursor | null;
}

export interface LocationListResult {
    rows: LocationRecord[];
    hasMore: boolean;
}

export interface NewLocationRecord {
    id: string;
    name: string;
    parentId: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

interface LocationSelectRow {
    id: string;
    name: string;
    parentId: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

const locationSelect = `
	SELECT
		id,
		name,
		parent_id AS parentId,
		sort_order AS sortOrder,
		created_at AS createdAt,
		updated_at AS updatedAt
	FROM storage_locations`;

const toLocationRecord = (row: LocationSelectRow): LocationRecord => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

export const listLocations = async (
    db: D1Database,
    query: LocationListQuery,
): Promise<LocationListResult> => {
    const statement = db
        .prepare(
            `${locationSelect}
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
    const result = await statement.all<LocationSelectRow>();
    const rows = result.results.map(toLocationRecord);
    return {
        rows: rows.slice(0, query.limit),
        hasMore: rows.length > query.limit,
    };
};

export const findLocationById = async (
    db: D1Database,
    id: LocationId,
): Promise<LocationRecord | null> => {
    const row = await db
        .prepare(`${locationSelect} WHERE id = ?1 LIMIT 1`)
        .bind(id)
        .first<LocationSelectRow>();
    return row ? toLocationRecord(row) : null;
};

/** Handles NULL parent_id explicitly because SQLite NULLs are not equal. */
export const findSiblingByName = async (
    db: D1Database,
    parentId: LocationId | null,
    name: string,
    excludeId?: LocationId,
): Promise<LocationRecord | null> => {
    const row = await db
        .prepare(
            `${locationSelect}
			WHERE ((parent_id IS NULL AND ?1 IS NULL) OR parent_id = ?1)
				AND name = ?2
				AND (?3 IS NULL OR id <> ?3)
			LIMIT 1`,
        )
        .bind(parentId, name, excludeId ?? null)
        .first<LocationSelectRow>();
    return row ? toLocationRecord(row) : null;
};

export const parentExists = async (
    db: D1Database,
    parentId: LocationId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            "SELECT 1 AS present FROM storage_locations WHERE id = ?1 LIMIT 1",
        )
        .bind(parentId)
        .first<{ present: number }>();
    return row !== null;
};

/** Checks descendants in arbitrary-depth trees using a recursive CTE. */
export const hasDescendant = async (
    db: D1Database,
    ancestorId: LocationId,
    candidateId: LocationId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            `WITH RECURSIVE descendants(id) AS (
				SELECT id FROM storage_locations WHERE parent_id = ?1
				UNION
				SELECT child.id
				FROM storage_locations AS child
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
    parentId: LocationId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            "SELECT 1 AS present FROM storage_locations WHERE parent_id = ?1 LIMIT 1",
        )
        .bind(parentId)
        .first<{ present: number }>();
    return row !== null;
};

/** Items have an ON DELETE RESTRICT foreign key to storage_locations. */
export const hasReferencingItems = async (
    db: D1Database,
    locationId: LocationId,
): Promise<boolean> => {
    const row = await db
        .prepare(
            "SELECT 1 AS present FROM items WHERE location_id = ?1 LIMIT 1",
        )
        .bind(locationId)
        .first<{ present: number }>();
    return row !== null;
};

export const insertLocation = async (
    db: D1Database,
    record: NewLocationRecord,
): Promise<LocationRecord> => {
    await db
        .prepare(
            `INSERT INTO storage_locations
				(id, name, parent_id, sort_order, created_at, updated_at)
			VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(
            record.id,
            record.name,
            record.parentId,
            record.sortOrder,
            record.createdAt,
            record.updatedAt,
        )
        .run();
    const inserted = await findLocationById(db, record.id);
    if (!inserted) {
        throw new Error("Inserted location could not be read back");
    }
    return inserted;
};

export const updateLocation = async (
    db: D1Database,
    id: LocationId,
    changes: LocationUpdateInput,
    updatedAt: string,
): Promise<LocationRecord> => {
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
    if (changes.sortOrder !== undefined) {
        assignments.push("sort_order = ?");
        values.push(changes.sortOrder);
    }
    assignments.push("updated_at = ?");
    values.push(updatedAt, id);

    await db
        .prepare(
            `UPDATE storage_locations
			SET ${assignments.join(", ")}
			WHERE id = ?`,
        )
        .bind(...values)
        .run();
    const updated = await findLocationById(db, id);
    if (!updated) {
        throw new Error("Updated location could not be read back");
    }
    return updated;
};

export const deleteLocation = async (
    db: D1Database,
    id: LocationId,
): Promise<void> => {
    await db
        .prepare("DELETE FROM storage_locations WHERE id = ?1")
        .bind(id)
        .run();
};

export const locationRepository = {
    listLocations,
    findLocationById,
    findSiblingByName,
    parentExists,
    hasDescendant,
    hasChildren,
    hasReferencingItems,
    insertLocation,
    updateLocation,
    deleteLocation,
};
