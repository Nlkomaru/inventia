import { newId } from "../domain/id";
import {
    decodeLocationCursor,
    encodeLocationCursor,
    type LocationCreateInput,
    type LocationDto,
    type LocationId,
    type LocationListInput,
    type LocationUpdateInput,
    locationCreateInputSchema,
    locationIdSchema,
    locationListInputSchema,
    locationUpdateInputSchema,
} from "../domain/location";
import {
    deleteLocation as deleteLocationRow,
    findLocationById,
    findSiblingByName,
    hasChildren,
    hasDescendant,
    hasReferencingItems,
    insertLocation,
    type LocationRecord,
    listAllLocations,
    listLocations as listLocationRows,
    parentExists,
    updateLocation as updateLocationRow,
} from "../repositories/locationRepository";

export type LocationServiceErrorCode =
    | "LOCATION_INVALID_INPUT"
    | "LOCATION_INVALID_CURSOR"
    | "LOCATION_NOT_FOUND"
    | "LOCATION_PARENT_NOT_FOUND"
    | "LOCATION_NAME_CONFLICT"
    | "LOCATION_PARENT_CYCLE"
    | "LOCATION_HAS_CHILDREN"
    | "LOCATION_IN_USE"
    | "LOCATION_CONFLICT"
    | "LOCATION_INTERNAL";

const statusByCode: Record<LocationServiceErrorCode, number> = {
    LOCATION_INVALID_INPUT: 400,
    LOCATION_INVALID_CURSOR: 400,
    LOCATION_NOT_FOUND: 404,
    LOCATION_PARENT_NOT_FOUND: 422,
    LOCATION_NAME_CONFLICT: 409,
    LOCATION_PARENT_CYCLE: 422,
    LOCATION_HAS_CHILDREN: 409,
    LOCATION_IN_USE: 409,
    LOCATION_CONFLICT: 409,
    LOCATION_INTERNAL: 500,
};

export class LocationServiceError extends Error {
    readonly status: number;

    constructor(
        readonly code: LocationServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "LocationServiceError";
        this.status = statusByCode[code];
    }
}

const invalidInput = (
    message = "入力値を確認してください",
): LocationServiceError =>
    new LocationServiceError("LOCATION_INVALID_INPUT", message);

const isConstraintViolation = (error: unknown): boolean =>
    /constraint|unique|foreign key/i.test(
        error instanceof Error ? error.message : String(error),
    );

const parseCreateInput = (input: unknown): LocationCreateInput => {
    const result = locationCreateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("場所名、親場所、並び順を確認してください");
    }
    return result.data;
};

const parseUpdateInput = (input: unknown): LocationUpdateInput => {
    const result = locationUpdateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("更新する場所名、親場所、並び順を確認してください");
    }
    return result.data;
};

const parseLocationId = (id: unknown): LocationId => {
    const result = locationIdSchema.safeParse(id);
    if (!result.success) {
        throw invalidInput("場所IDを確認してください");
    }
    return result.data;
};

const parseListInput = (input: unknown): LocationListInput => {
    const result = locationListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("parentId、q、limit、cursorを確認してください");
    }
    return result.data;
};

// 空文字の検索語は絞り込みなしとして扱う。cursorのスコープ判定も同じ正規化値で行う
const normalizeSearch = (q: string | undefined): string | null =>
    q !== undefined && q.length > 0 ? q : null;

const toDto = (row: LocationRecord): LocationDto => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const ensureParentExists = async (
    db: D1Database,
    parentId: LocationId | null,
): Promise<void> => {
    if (parentId !== null && !(await parentExists(db, parentId))) {
        throw new LocationServiceError(
            "LOCATION_PARENT_NOT_FOUND",
            "指定された親場所が見つかりません",
        );
    }
};

export type LocationListResponse = {
    items: LocationDto[];
    nextCursor: string | null;
};

export const listLocations = async (
    db: D1Database,
    input: unknown = {},
): Promise<LocationListResponse> => {
    const query = parseListInput(input);
    const search = normalizeSearch(query.q);
    const cursor = query.cursor ? decodeLocationCursor(query.cursor) : null;
    // 親場所と検索語のどちらかが違う cursor は別の一覧の続きになるため拒否する
    if (
        query.cursor &&
        (!cursor || cursor.parentId !== query.parentId || cursor.q !== search)
    ) {
        throw new LocationServiceError(
            "LOCATION_INVALID_CURSOR",
            "cursorが不正です。同じ親場所と同じ検索語の一覧で取得したcursorを使用してください",
        );
    }
    const page = await listLocationRows(db, {
        parentId: query.parentId,
        q: search,
        limit: query.limit,
        cursor,
    });
    const items = page.rows.map(toDto);
    return {
        items,
        nextCursor:
            page.hasMore && page.rows.length > 0
                ? encodeLocationCursor({
                      parentId: query.parentId,
                      q: search,
                      sortOrder: page.rows[page.rows.length - 1].sortOrder,
                      id: page.rows[page.rows.length - 1].id,
                  })
                : null,
    };
};

// ツリー表示は全件が必要なため、階層ごとのページングを繰り返さず 1 クエリで読む
export const locationTreeMaxSize = 1000;

export type LocationTreeResponse = {
    items: LocationDto[];
    truncated: boolean;
};

export const listLocationTree = async (
    db: D1Database,
): Promise<LocationTreeResponse> => {
    const page = await listAllLocations(db, locationTreeMaxSize);
    return { items: page.rows.map(toDto), truncated: page.hasMore };
};

export const getLocation = async (
    db: D1Database,
    id: unknown,
): Promise<LocationDto> => {
    const locationId = parseLocationId(id);
    const row = await findLocationById(db, locationId);
    if (!row) {
        throw new LocationServiceError(
            "LOCATION_NOT_FOUND",
            "指定された場所が見つかりません",
        );
    }
    return toDto(row);
};

export const createLocation = async (
    db: D1Database,
    input: unknown,
): Promise<LocationDto> => {
    const parsed = parseCreateInput(input);
    await ensureParentExists(db, parsed.parentId);
    if (await findSiblingByName(db, parsed.parentId, parsed.name)) {
        throw new LocationServiceError(
            "LOCATION_NAME_CONFLICT",
            "同じ階層に同名の場所が既に存在します",
        );
    }

    const now = new Date().toISOString();
    const id = newId();
    try {
        const row = await insertLocation(db, {
            id,
            name: parsed.name,
            parentId: parsed.parentId,
            sortOrder: parsed.sortOrder,
            createdAt: now,
            updatedAt: now,
        });
        return toDto(row);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new LocationServiceError(
                "LOCATION_NAME_CONFLICT",
                "同じ階層に同名の場所が既に存在します",
            );
        }
        throw error;
    }
};

export const updateLocation = async (
    db: D1Database,
    id: unknown,
    input: unknown,
): Promise<LocationDto> => {
    const locationId = parseLocationId(id);
    const parsed = parseUpdateInput(input);
    const current = await findLocationById(db, locationId);
    if (!current) {
        throw new LocationServiceError(
            "LOCATION_NOT_FOUND",
            "指定された場所が見つかりません",
        );
    }

    const nextParentId =
        parsed.parentId === undefined ? current.parentId : parsed.parentId;
    await ensureParentExists(db, nextParentId);
    if (nextParentId === locationId) {
        throw new LocationServiceError(
            "LOCATION_PARENT_CYCLE",
            "場所を自分自身の親には設定できません",
        );
    }
    if (
        nextParentId !== null &&
        (await hasDescendant(db, locationId, nextParentId))
    ) {
        throw new LocationServiceError(
            "LOCATION_PARENT_CYCLE",
            "子孫の場所を親には設定できません",
        );
    }

    const nextName = parsed.name ?? current.name;
    if (await findSiblingByName(db, nextParentId, nextName, locationId)) {
        throw new LocationServiceError(
            "LOCATION_NAME_CONFLICT",
            "同じ階層に同名の場所が既に存在します",
        );
    }

    try {
        const row = await updateLocationRow(
            db,
            locationId,
            parsed,
            new Date().toISOString(),
        );
        return toDto(row);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new LocationServiceError(
                "LOCATION_CONFLICT",
                "場所を更新できませんでした。内容を確認して再試行してください",
            );
        }
        throw error;
    }
};

export const removeLocation = async (
    db: D1Database,
    id: unknown,
): Promise<void> => {
    const locationId = parseLocationId(id);
    if (!(await findLocationById(db, locationId))) {
        throw new LocationServiceError(
            "LOCATION_NOT_FOUND",
            "指定された場所が見つかりません",
        );
    }
    if (await hasChildren(db, locationId)) {
        throw new LocationServiceError(
            "LOCATION_HAS_CHILDREN",
            "子場所があるため削除できません。先に子場所を移動または削除してください",
        );
    }
    if (await hasReferencingItems(db, locationId)) {
        throw new LocationServiceError(
            "LOCATION_IN_USE",
            "商品が参照しているため削除できません。先に商品を移動してください",
        );
    }
    try {
        await deleteLocationRow(db, locationId);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new LocationServiceError(
                "LOCATION_IN_USE",
                "参照中のため削除できません。先に参照を解除してください",
            );
        }
        throw error;
    }
};

export const deleteLocation = removeLocation;
