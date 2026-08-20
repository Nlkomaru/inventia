import {
    type ItemCreateInput,
    type ItemDetailDto,
    type ItemDto,
    type ItemListQuery,
    type ItemUpdateInput,
    itemCreateSchema,
    itemListQuerySchema,
    itemUpdateSchema,
} from "../domain/item";
import {
    earliestExpiryDate,
    type ItemLotDto,
    lotExpiryDateSchema,
} from "../domain/lot";
import { getPriceUnitDefinition } from "../domain/price";
import { type ReadingStatus, toReadingStateDto } from "../domain/reading";
import { findCategoryById } from "../repositories/categoryRepository";
import {
    categoryExists,
    countItemsByLocation as countItemRecordsByLocation,
    createItem as createItemRecord,
    deleteItem as deleteItemRecord,
    getCategoryKind,
    getItem as getItemRecord,
    getItemsByIds,
    InvalidItemCursorError,
    type ItemRow,
    listItems as listItemRecords,
    locationExists,
    updateItem as updateItemRecord,
} from "../repositories/itemRepository";
import {
    type ItemLotRow,
    listItemLots,
    listItemLotsByItemIds,
} from "../repositories/lotRepository";
import { itemHasPriceRecords } from "../repositories/priceRepository";
import {
    getReadingState as getReadingStateRecord,
    listReadingStatesByItemIds,
    type ReadingStateRow,
} from "../repositories/readingRepository";
import {
    generateItemEmoji,
    type ItemEmojiEnv,
    type ItemEmojiSource,
    requestItemEmoji,
} from "./itemEmojiService";

export class ItemServiceError extends Error {
    readonly status: 400 | 404 | 409 | 502 | 503;
    readonly code: string;

    constructor(
        status: 400 | 404 | 409 | 502 | 503,
        code: string,
        message: string,
    ) {
        super(message);
        this.name = "ItemServiceError";
        this.status = status;
        this.code = code;
    }
}

const validationMessage = (
    issues: { message: string; path: PropertyKey[] }[],
) =>
    issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join(", ");

const parseOrThrow = <T>(
    result:
        | { success: true; data: T }
        | {
              success: false;
              error: { issues: { message: string; path: PropertyKey[] }[] };
          },
): T => {
    if (!result.success) {
        throw new ItemServiceError(
            400,
            "VALIDATION_ERROR",
            validationMessage(result.error.issues),
        );
    }
    return result.data;
};

const isItemDeleteForeignKeyConflict = (error: unknown): boolean =>
    /\bforeign key constraint failed\b|\bSQLITE_CONSTRAINT_FOREIGNKEY\b/i.test(
        error instanceof Error ? error.message : String(error),
    );

const isDocumentCategory = (
    kind: Awaited<ReturnType<typeof getCategoryKind>>,
): boolean => kind === "document";

// 読書状態一覧など他 service でも同じ公開モデルへ変換するため export する。
// readingStatus は品目行に無いため、呼び出し側が解決した値を渡す
export const toItemDto = (
    row: ItemRow,
    readingStatus: ReadingStatus | null,
): ItemDto => ({
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    categoryId: row.categoryId,
    locationId: row.locationId,
    baseUnit: row.baseUnit,
    baseDimension: row.baseDimension,
    currentQuantity: row.currentQuantity,
    earliestExpiryDate: lotExpiryDateSchema.parse(row.earliestExpiryDate),
    lotCount: row.lotCount,
    lowStockThreshold: row.lowStockThreshold,
    memo: row.memo,
    readingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const toLotDto = (row: ItemLotRow): ItemLotDto => ({
    id: row.id,
    itemId: row.itemId,
    expiryDate: row.expiryDate,
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

// 詳細では同梱したロットから期限集計を導き、内訳と要約が食い違わないようにする
const toDetailDto = (
    row: ItemRow,
    lots: ItemLotRow[],
    reading: ReadingStateRow | null,
): ItemDetailDto => ({
    ...toItemDto(row, reading?.status ?? null),
    earliestExpiryDate: earliestExpiryDate(lots),
    lotCount: lots.length,
    lots: lots.map(toLotDto),
    readingState: reading ? toReadingStateDto(reading) : null,
});

export const listItems = async (
    db: D1Database,
    input: unknown,
): Promise<{ items: ItemDto[]; nextCursor: string | null }> => {
    const query = parseOrThrow(itemListQuerySchema.safeParse(input));
    try {
        const result = await listItemRecords(db, query);
        // 読書状態はページに並んだ品目 id の IN 句 1 回で解決する（N+1 禁止）
        const readingStates = await listReadingStatesByItemIds(
            db,
            result.items.map((row) => row.id),
        );
        return {
            items: result.items.map((row) =>
                toItemDto(row, readingStates.get(row.id)?.status ?? null),
            ),
            nextCursor: result.nextCursor,
        };
    } catch (error) {
        if (error instanceof InvalidItemCursorError) {
            throw new ItemServiceError(
                400,
                "INVALID_CURSOR",
                "cursor is invalid",
            );
        }
        throw error;
    }
};

/**
 * 保管場所 id ごとの品目件数を返す。件数が 0 の場所は含まれない。
 * 階層をまたぐ合算は保管場所ツリーを持つ呼び出し側の責務とする。
 */
export const countItemsByLocation = async (
    db: D1Database,
): Promise<Record<string, number>> => {
    const rows = await countItemRecordsByLocation(db);
    return Object.fromEntries(
        rows.map((row) => [row.locationId, row.itemCount]),
    );
};

export const getItem = async (
    db: D1Database,
    id: string,
): Promise<ItemDetailDto> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    const row = await getItemRecord(db, id);
    if (!row) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    // 数量 0 のロットは既定の表示対象外のため詳細にも含めない
    const [lots, reading] = await Promise.all([
        listItemLots(db, id, { includeEmpty: false }),
        getReadingStateRecord(db, id),
    ]);
    return toDetailDto(row, lots, reading);
};

/**
 * 複数の品目をまとめて読む。1 件ずつ引くと呼び出し回数が id の数に比例するため、
 * 品目・ロット・読書状態をそれぞれ IN 句 1 回（必要ならチャンク分割）で解決する。
 * 見つからない id は例外にせず `notFound` へ返し、1 件の欠落で全体を失わせない。
 * 結果は渡した id の順に並べる（repository の結果順は DB 依存で不定）。
 */
export const getItems = async (
    db: D1Database,
    ids: readonly string[],
    options: { includeLots: boolean } = { includeLots: true },
): Promise<{ items: ItemDetailDto[]; notFound: string[] }> => {
    const unique = [...new Set(ids.map((id) => id.trim()))].filter(
        (id) => id.length > 0,
    );
    if (unique.length === 0) {
        return { items: [], notFound: [] };
    }
    const [rows, lotsByItemId, readingStates] = await Promise.all([
        getItemsByIds(db, unique),
        options.includeLots
            ? listItemLotsByItemIds(db, unique, { includeEmpty: false })
            : Promise.resolve(new Map<string, ItemLotRow[]>()),
        listReadingStatesByItemIds(db, unique),
    ]);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const items: ItemDetailDto[] = [];
    const notFound: string[] = [];
    for (const id of unique) {
        const row = rowById.get(id);
        if (!row) {
            notFound.push(id);
            continue;
        }
        const reading = readingStates.get(id) ?? null;
        if (options.includeLots) {
            items.push(toDetailDto(row, lotsByItemId.get(id) ?? [], reading));
            continue;
        }
        // ロットを載せない場合も件数と最短期限は行の集計列から返す（`itemColumns` が
        // 数量 > 0 のロットを数えている）。lots だけが空になる
        items.push({
            ...toItemDto(row, reading?.status ?? null),
            lots: [],
            readingState: reading ? toReadingStateDto(reading) : null,
        });
    }
    return { items, notFound };
};

/**
 * 絵文字の生成に渡す手掛かりを揃える。カテゴリ名は選定の手掛かりとして強いため
 * 1 件だけ読む。絵文字を生成しない経路ではこの読み取り自体を行わない。
 */
const buildEmojiSource = async (
    db: D1Database,
    input: { name: string; categoryId: string; memo: string | null },
): Promise<ItemEmojiSource> => ({
    name: input.name,
    categoryName: (await findCategoryById(db, input.categoryId))?.name ?? null,
    memo: input.memo,
});

/**
 * 品目を作る。`options.id` は再実行で同じ品目へ収束させたい呼び出し元
 * （レシート反映など）が採番済みの ID を渡すためだけにあり、
 * 公開入力スキーマ（`itemCreateSchema`）には含めない。
 * 絵文字を省略した場合は AI で生成するが、生成できなくても既定の絵文字で作成を続ける。
 */
export const createItem = async (
    env: ItemEmojiEnv,
    input: unknown,
    options: { id?: string } = {},
): Promise<ItemDto> => {
    const db = env.DB;
    const parsed = parseOrThrow(itemCreateSchema.safeParse(input));
    if (!(await categoryExists(db, parsed.categoryId))) {
        throw new ItemServiceError(
            404,
            "CATEGORY_NOT_FOUND",
            "category was not found",
        );
    }
    if (!(await locationExists(db, parsed.locationId))) {
        throw new ItemServiceError(
            404,
            "LOCATION_NOT_FOUND",
            "location was not found",
        );
    }
    const categoryKind = await getCategoryKind(db, parsed.categoryId);
    const isDocument = categoryKind === "document";
    const baseUnit = parsed.baseUnit ?? (isDocument ? "件" : undefined);
    const baseDimension =
        parsed.baseDimension ?? (isDocument ? "count" : undefined);
    if (!baseUnit || !baseDimension) {
        throw new ItemServiceError(
            400,
            "BASE_UNIT_REQUIRED",
            "baseUnit and baseDimension are required for this category",
        );
    }
    const currentQuantity = parsed.currentQuantity ?? (isDocument ? 1 : 0);
    const emoji =
        parsed.emoji ??
        (await generateItemEmoji(
            env,
            await buildEmojiSource(db, {
                name: parsed.name,
                categoryId: parsed.categoryId,
                memo: parsed.memo ?? null,
            }),
        ));
    const row = await createItemRecord(
        db,
        {
            ...parsed,
            baseUnit,
            baseDimension,
            currentQuantity,
            emoji,
        },
        options,
    );
    // 作成直後の品目は読書状態を持たない
    return toItemDto(row, null);
};

/**
 * つけ替えで価格記録が読めなくなる組み合わせを拒む。単価は保存せず、読み取り
 * のたびに品目の「現在の」基準単位から最小単位（質量は g、体積は mL）へ直して
 * 導くため、質量・体積で単位表に無い基準単位（袋、パックなど）へ移すと、既存の
 * 価格記録が単価を導けなくなり品目詳細・価格一覧・価格ツールがまとめて落ちる。
 * 価格記録の作成は同じ換算を通しているので、ここを塞げば「価格記録がある品目の
 * 基準単位は換算できる」という不変条件が書き込み側で保たれる。個数は基準単位が
 * そのまま最小単位なので、どの表記でも読める。
 */
const assertRelabelKeepsPricesReadable = async (
    db: D1Database,
    id: string,
    existing: ItemRow,
    parsed: ItemUpdateInput,
): Promise<void> => {
    const nextUnit = parsed.baseUnit ?? existing.baseUnit;
    const nextDimension = parsed.baseDimension ?? existing.baseDimension;
    if (
        nextUnit === existing.baseUnit &&
        nextDimension === existing.baseDimension
    ) {
        return;
    }
    if (nextDimension === "count") {
        return;
    }
    const definition = getPriceUnitDefinition(nextUnit);
    if (definition && definition.dimension === nextDimension) {
        return;
    }
    if (!(await itemHasPriceRecords(db, id))) {
        return;
    }
    throw new ItemServiceError(
        409,
        "ITEM_PRICE_UNIT_CONFLICT",
        "the item holds price records, so a mass base unit must be g or kg and a volume base unit must be mL or L",
    );
};

/**
 * 品目のマスタ情報を更新する。baseUnit / baseDimension も変更できるが、これは
 * 換算を伴わない「つけ替え」で、item_lots・stock_movements・price_records は
 * 一切書き換えない（items の数量キャッシュ current_quantity と、基準単位で
 * 表した在庫下限 low_stock_threshold も触らない）。保存済みの数値がそのまま
 * 新しい単位の数量として読まれることになるため、在庫や履歴を持つ品目では
 * 呼び出し側が利用者へ警告してから呼ぶこと。
 * 応答は更新後の ItemDto をそのまま返し、単位が変わった後の見え方を
 * 呼び出し側がそのまま確認できるようにする。
 */
export const updateItem = async (
    db: D1Database,
    id: string,
    input: unknown,
): Promise<ItemDto> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    const parsed = parseOrThrow(itemUpdateSchema.safeParse(input));
    const existing = await getItemRecord(db, id);
    if (!existing) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    if (parsed.categoryId && !(await categoryExists(db, parsed.categoryId))) {
        throw new ItemServiceError(
            404,
            "CATEGORY_NOT_FOUND",
            "category was not found",
        );
    }
    if (parsed.locationId && !(await locationExists(db, parsed.locationId))) {
        throw new ItemServiceError(
            404,
            "LOCATION_NOT_FOUND",
            "location was not found",
        );
    }
    if (parsed.categoryId && parsed.categoryId !== existing.categoryId) {
        const [currentCategoryKind, nextCategoryKind] = await Promise.all([
            getCategoryKind(db, existing.categoryId),
            getCategoryKind(db, parsed.categoryId),
        ]);
        if (
            isDocumentCategory(currentCategoryKind) !==
            isDocumentCategory(nextCategoryKind)
        ) {
            throw new ItemServiceError(
                409,
                "ITEM_CATEGORY_KIND_CONFLICT",
                "item category cannot cross the document and non-document boundary",
            );
        }
        // 読書状態は書籍カテゴリーの品目だけが持つ。保存済みのまま書籍から外れる
        // 移動を許すと、書籍以外の品目が readingStatus を返し続けて
        // readingStatus での絞り込みにも現れ、書籍以外を拒否する upsert では
        // その行を直せなくなるため、先に読書状態の削除を求める
        if (
            currentCategoryKind === "book" &&
            nextCategoryKind !== "book" &&
            (await getReadingStateRecord(db, id)) !== null
        ) {
            throw new ItemServiceError(
                409,
                "ITEM_READING_STATE_CONFLICT",
                "clear the reading state before moving the item out of a book category",
            );
        }
    }
    await assertRelabelKeepsPricesReadable(db, id, existing, parsed);
    // baseUnit / baseDimension を含めて items の 1 行だけを書き換える。
    // 数量を持つテーブルへの換算処理は意図的に行わない
    const row = await updateItemRecord(db, id, parsed);
    if (!row) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    const reading = await getReadingStateRecord(db, id);
    return toItemDto(row, reading?.status ?? null);
};

/**
 * 既存品目の絵文字を AI で作り直す。生成できなかった場合は保存済みの絵文字を
 * そのまま残して失敗を返し、利用者が絵文字を直接入力して直せるようにする。
 * 文言は API 利用者だけでなく画面にもそのまま出るため、次に取れる行動を日本語で書く。
 */
export const regenerateItemEmoji = async (
    env: ItemEmojiEnv,
    id: string,
): Promise<ItemDto> => {
    const db = env.DB;
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    const existing = await getItemRecord(db, id);
    if (!existing) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    const generated = await requestItemEmoji(
        env,
        await buildEmojiSource(db, existing),
    );
    if (!generated.ok) {
        throw generated.reason === "not_configured"
            ? new ItemServiceError(
                  503,
                  "ITEM_EMOJI_NOT_CONFIGURED",
                  "OpenRouter API key を連携設定から保存してください。",
              )
            : new ItemServiceError(
                  502,
                  "ITEM_EMOJI_UNAVAILABLE",
                  "絵文字を生成できませんでした。時間をおいて再試行するか、絵文字を直接入力してください。",
              );
    }
    const row = await updateItemRecord(db, id, { emoji: generated.emoji });
    if (!row) {
        throw new ItemServiceError(404, "ITEM_NOT_FOUND", "item was not found");
    }
    const reading = await getReadingStateRecord(db, id);
    return toItemDto(row, reading?.status ?? null);
};

export const deleteItem = async (db: D1Database, id: string): Promise<void> => {
    if (id.trim().length === 0) {
        throw new ItemServiceError(400, "INVALID_ID", "id must not be empty");
    }
    try {
        if (!(await deleteItemRecord(db, id))) {
            throw new ItemServiceError(
                404,
                "ITEM_NOT_FOUND",
                "item was not found",
            );
        }
    } catch (error) {
        if (isItemDeleteForeignKeyConflict(error)) {
            throw new ItemServiceError(
                409,
                "ITEM_DELETE_CONFLICT",
                "item cannot be deleted because it has stock history",
            );
        }
        throw error;
    }
};

export type { ItemCreateInput, ItemListQuery, ItemUpdateInput };
