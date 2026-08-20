import { newId } from "../domain/id";
import {
    decodeStoreCursor,
    encodeStoreCursor,
    type StoreCreateInput,
    type StoreDto,
    type StoreId,
    type StoreListInput,
    type StoreUpdateInput,
    storeCreateInputSchema,
    storeFaviconContentTypeExtensions,
    storeFaviconContentTypeSchema,
    storeFaviconMaxByteSize,
    storeFaviconPath,
    storeIdSchema,
    storeListInputSchema,
    storeNameMaxLength,
    storeUpdateInputSchema,
} from "../domain/store";
import {
    countPriceRecordsByStore,
    deleteStore as deleteStoreRow,
    findStoreById,
    findStoreByName,
    insertStore,
    listStores as listStoreRows,
    type StoreRow,
    updateStoreFavicon,
    updateStore as updateStoreRow,
} from "../repositories/storeRepository";

export type StoreServiceErrorCode =
    | "STORE_INVALID_INPUT"
    | "STORE_INVALID_CURSOR"
    | "STORE_NOT_FOUND"
    | "STORE_NAME_CONFLICT"
    | "STORE_IN_USE"
    | "STORE_FAVICON_NOT_FOUND"
    | "STORE_TOO_LARGE"
    | "STORE_UNSUPPORTED_MEDIA_TYPE"
    | "STORE_STORAGE_ERROR";

const statusByCode: Record<
    StoreServiceErrorCode,
    400 | 404 | 409 | 413 | 415 | 503
> = {
    STORE_INVALID_INPUT: 400,
    STORE_INVALID_CURSOR: 400,
    STORE_NOT_FOUND: 404,
    STORE_NAME_CONFLICT: 409,
    STORE_IN_USE: 409,
    STORE_FAVICON_NOT_FOUND: 404,
    STORE_TOO_LARGE: 413,
    STORE_UNSUPPORTED_MEDIA_TYPE: 415,
    STORE_STORAGE_ERROR: 503,
};

export class StoreServiceError extends Error {
    readonly status: 400 | 404 | 409 | 413 | 415 | 503;

    constructor(
        readonly code: StoreServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "StoreServiceError";
        this.status = statusByCode[code];
    }
}

/**
 * 店舗が必要とする binding だけの構造型。`Env` はこの形へ代入できる。
 * ファビコン画像はレシートと同じ RECEIPTS バケットへ置く。専用の binding を
 * 足すと wrangler.jsonc・cf-typegen・バケット作成が必要になるため流用する。
 */
export interface StoreEnv {
    DB: D1Database;
    RECEIPTS: R2Bucket;
}

const invalidInput = (message: string): StoreServiceError =>
    new StoreServiceError("STORE_INVALID_INPUT", message);

const isConstraintViolation = (error: unknown): boolean =>
    /constraint|unique/i.test(
        error instanceof Error ? error.message : String(error),
    );

const nameConflict = (): StoreServiceError =>
    new StoreServiceError(
        "STORE_NAME_CONFLICT",
        "同じ名前の店舗が既に存在します",
    );

const notFound = (): StoreServiceError =>
    new StoreServiceError("STORE_NOT_FOUND", "指定された店舗が見つかりません");

const parseStoreId = (id: unknown): StoreId => {
    const result = storeIdSchema.safeParse(id);
    if (!result.success) {
        throw invalidInput("店舗IDを確認してください");
    }
    return result.data;
};

const parseCreateInput = (input: unknown): StoreCreateInput => {
    const result = storeCreateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("店名とURLを確認してください");
    }
    return result.data;
};

const parseUpdateInput = (input: unknown): StoreUpdateInput => {
    const result = storeUpdateInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("更新する店名とURLを確認してください");
    }
    return result.data;
};

const parseListInput = (input: unknown): StoreListInput => {
    const result = storeListInputSchema.safeParse(input);
    if (!result.success) {
        throw invalidInput("q、limit、cursorを確認してください");
    }
    return result.data;
};

// 空文字の検索語は絞り込みなしとして扱う。cursorのスコープ判定も同じ正規化値で行う
const normalizeSearch = (q: string | undefined): string | null =>
    q !== undefined && q.length > 0 ? q : null;

const toDto = (row: StoreRow): StoreDto => ({
    id: row.id,
    name: row.name,
    url: row.url,
    faviconUrl: row.faviconObjectKey === null ? null : storeFaviconPath(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const requireStore = async (db: D1Database, id: StoreId): Promise<StoreRow> => {
    const row = await findStoreById(db, id);
    if (!row) {
        throw notFound();
    }
    return row;
};

export type StoreListResponse = {
    items: StoreDto[];
    nextCursor: string | null;
};

export const listStores = async (
    db: D1Database,
    input: unknown = {},
): Promise<StoreListResponse> => {
    const query = parseListInput(input);
    const search = normalizeSearch(query.q);
    const cursor = query.cursor ? decodeStoreCursor(query.cursor) : null;
    // 検索語が違う cursor は別の一覧の続きになるため拒否する
    if (query.cursor && (!cursor || cursor.q !== search)) {
        throw new StoreServiceError(
            "STORE_INVALID_CURSOR",
            "cursorが不正です。同じ検索語の一覧で取得したcursorを使用してください",
        );
    }
    const page = await listStoreRows(db, {
        q: search,
        limit: query.limit,
        cursor,
    });
    const last = page.rows.at(-1);
    return {
        items: page.rows.map(toDto),
        nextCursor:
            page.hasMore && last
                ? encodeStoreCursor({ q: search, name: last.name, id: last.id })
                : null,
    };
};

export const getStore = async (
    db: D1Database,
    id: unknown,
): Promise<StoreDto> => toDto(await requireStore(db, parseStoreId(id)));

export const createStore = async (
    db: D1Database,
    input: unknown,
): Promise<StoreDto> => {
    const parsed = parseCreateInput(input);
    if (await findStoreByName(db, parsed.name)) {
        throw nameConflict();
    }
    const now = new Date().toISOString();
    try {
        return toDto(
            await insertStore(db, {
                id: newId(),
                name: parsed.name,
                url: parsed.url,
                createdAt: now,
                updatedAt: now,
            }),
        );
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw nameConflict();
        }
        throw error;
    }
};

export const updateStore = async (
    db: D1Database,
    id: unknown,
    input: unknown,
): Promise<StoreDto> => {
    const storeId = parseStoreId(id);
    const parsed = parseUpdateInput(input);
    await requireStore(db, storeId);
    if (parsed.name !== undefined) {
        const duplicate = await findStoreByName(db, parsed.name);
        if (duplicate && duplicate.id !== storeId) {
            throw nameConflict();
        }
    }
    try {
        const row = await updateStoreRow(
            db,
            storeId,
            parsed,
            new Date().toISOString(),
        );
        if (!row) {
            throw notFound();
        }
        return toDto(row);
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw nameConflict();
        }
        throw error;
    }
};

export const deleteStore = async (
    env: StoreEnv,
    id: unknown,
): Promise<void> => {
    const storeId = parseStoreId(id);
    const store = await requireStore(env.DB, storeId);
    // price_records は ON DELETE RESTRICT で参照するため、先に理由を返す
    if ((await countPriceRecordsByStore(env.DB, storeId)) > 0) {
        throw new StoreServiceError(
            "STORE_IN_USE",
            "価格履歴が参照しているため削除できません。先に価格履歴の店舗を変更してください",
        );
    }
    try {
        if (!(await deleteStoreRow(env.DB, storeId))) {
            throw notFound();
        }
    } catch (error) {
        if (isConstraintViolation(error)) {
            throw new StoreServiceError(
                "STORE_IN_USE",
                "参照中のため削除できません。先に参照を解除してください",
            );
        }
        throw error;
    }
    // 参照されないオブジェクトを残さない。削除に失敗しても店舗の削除は成功している
    if (store.faviconObjectKey !== null) {
        await env.RECEIPTS.delete(store.faviconObjectKey).catch(
            () => undefined,
        );
    }
};

/**
 * 店名から店舗を引き、無ければ作る。レシート反映のように利用者が店舗を
 * 選んでいない経路から使うため、名前以外の入力は取らない。
 */
export const findOrCreateStoreByName = async (
    db: D1Database,
    name: string,
): Promise<StoreRow> => {
    // 読み取った店名が上限より長くても反映を止めない。ここで入力エラーにすると、
    // 購入を確定した後のレシート反映が再実行でも回復しなくなる
    const normalized = name.trim().slice(0, storeNameMaxLength);
    if (normalized.length === 0) {
        throw invalidInput("店名を確認してください");
    }
    const existing = await findStoreByName(db, normalized);
    if (existing) {
        return existing;
    }
    const now = new Date().toISOString();
    try {
        return await insertStore(db, {
            id: newId(),
            name: normalized,
            url: null,
            createdAt: now,
            updatedAt: now,
        });
    } catch (error) {
        if (!isConstraintViolation(error)) {
            throw error;
        }
        // 同時実行が先に同じ名前を作った場合は、その行へ収束させる
        const concurrent = await findStoreByName(db, normalized);
        if (!concurrent) {
            throw error;
        }
        return concurrent;
    }
};

export const uploadStoreFavicon = async (
    env: StoreEnv,
    id: unknown,
    input: { bytes: ArrayBuffer | Uint8Array; contentType: string },
): Promise<StoreDto> => {
    const storeId = parseStoreId(id);
    const store = await requireStore(env.DB, storeId);
    const contentType = storeFaviconContentTypeSchema.safeParse(
        input.contentType.split(";")[0]?.trim().toLowerCase() ?? "",
    );
    if (!contentType.success) {
        throw new StoreServiceError(
            "STORE_UNSUPPORTED_MEDIA_TYPE",
            "対応していない画像形式です。PNG、JPEG、WebP のいずれかでアップロードしてください。",
        );
    }
    const byteSize = input.bytes.byteLength;
    if (byteSize === 0) {
        throw invalidInput("空のファイルはアップロードできません。");
    }
    if (byteSize > storeFaviconMaxByteSize) {
        throw new StoreServiceError(
            "STORE_TOO_LARGE",
            "画像サイズが 1 MiB を超えています。小さい画像を選び直してください。",
        );
    }
    const objectKey = `stores/${storeId}.${storeFaviconContentTypeExtensions[contentType.data]}`;
    try {
        await env.RECEIPTS.put(objectKey, input.bytes, {
            httpMetadata: { contentType: contentType.data },
        });
    } catch {
        throw new StoreServiceError(
            "STORE_STORAGE_ERROR",
            "画像を保存できませんでした。時間をおいて再試行してください。",
        );
    }
    let row: StoreRow | null;
    try {
        row = await updateStoreFavicon(
            env.DB,
            storeId,
            {
                objectKey,
                contentType: contentType.data,
                byteSize,
            },
            new Date().toISOString(),
        );
    } catch (error) {
        // 参照されないオブジェクトを残さない。削除に失敗しても元の失敗を返す
        await env.RECEIPTS.delete(objectKey).catch(() => undefined);
        throw error;
    }
    if (!row) {
        await env.RECEIPTS.delete(objectKey).catch(() => undefined);
        throw notFound();
    }
    // 拡張子が変わる差し替えでは古いオブジェクトが残るため消す
    if (
        store.faviconObjectKey !== null &&
        store.faviconObjectKey !== objectKey
    ) {
        await env.RECEIPTS.delete(store.faviconObjectKey).catch(
            () => undefined,
        );
    }
    return toDto(row);
};

/**
 * 保存済みのファビコンを読み出す。本文はストリームのまま返し、Worker が
 * 画像全体をメモリへ載せないようにする。R2 のオブジェクトキーは公開しない。
 */
export const getStoreFavicon = async (
    env: StoreEnv,
    id: unknown,
): Promise<{
    body: ReadableStream;
    contentType: string;
    byteSize: number;
    etag: string;
}> => {
    const storeId = parseStoreId(id);
    const store = await requireStore(env.DB, storeId);
    if (
        store.faviconObjectKey === null ||
        store.faviconContentType === null ||
        store.faviconByteSize === null
    ) {
        throw new StoreServiceError(
            "STORE_FAVICON_NOT_FOUND",
            "この店舗には画像が登録されていません。",
        );
    }
    const object = await env.RECEIPTS.get(store.faviconObjectKey);
    if (!object) {
        throw new StoreServiceError(
            "STORE_FAVICON_NOT_FOUND",
            "画像が見つかりません。アップロードし直してください。",
        );
    }
    return {
        body: object.body,
        contentType: store.faviconContentType,
        // アップロードが途中で失敗すると D1 の値と R2 の実体がずれるため、
        // 長さは実際に配信するオブジェクトから取る
        byteSize: object.size,
        etag: object.httpEtag,
    };
};

export const deleteStoreFavicon = async (
    env: StoreEnv,
    id: unknown,
): Promise<StoreDto> => {
    const storeId = parseStoreId(id);
    const store = await requireStore(env.DB, storeId);
    const row = await updateStoreFavicon(
        env.DB,
        storeId,
        null,
        new Date().toISOString(),
    );
    if (!row) {
        throw notFound();
    }
    if (store.faviconObjectKey !== null) {
        await env.RECEIPTS.delete(store.faviconObjectKey).catch(
            () => undefined,
        );
    }
    return toDto(row);
};

export type { StoreRow };
