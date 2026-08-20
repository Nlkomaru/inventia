import { z } from "zod";
import { externalProviderDtoSchema } from "./externalProvider";
import { itemDtoSchema } from "./item";
import {
    itemLotDtoSchema,
    type LotStocktakeEntry,
    lotAllocationDtoSchema,
    lotExpiryDateSchema,
} from "./lot";

export const stockMovementReasons = [
    "purchase",
    "stocktake",
    "consume",
    "discard",
    "other",
] as const;

export const stockMovementReasonSchema = z.enum(stockMovementReasons);
export type StockMovementReason = z.infer<typeof stockMovementReasonSchema>;

export const stockOperationKinds = ["adjustment", "stocktake"] as const;
export const stockOperationKindSchema = z.enum(stockOperationKinds);
export type StockOperationKind = z.infer<typeof stockOperationKindSchema>;

export const stockOccurredAtSchema = z.iso
    .datetime({ offset: true })
    .refine(
        (value) => value.endsWith("Z") || value.endsWith("+00:00"),
        "must be a UTC date-time",
    );

const idempotencyKeySchema = z.string().trim().min(1).max(200);

const lotIdSchema = z.string().trim().min(1).max(128);

// 制御文字を弾くのは表示のためだけではない。stockRequestDigest は値を制御文字で
// 区切って連結するため、入力に区切り文字が混ざると内訳の違う再送が同じ digest に
// なり、IDEMPOTENCY_CONFLICT として検出できなくなる
const controlCharacterFree = /^\P{Cc}*$/u;

// 在庫を何に使ったかの記録。reason（enum）では表せない用途と、外部アプリへの
// 参照を持つ。棚卸しは「数えた結果」であり行き先を持たないため、
// stocktakeSchema には足さない
const stockNoteSchema = z
    .string()
    .trim()
    .min(1, "用途は1文字以上で入力してください")
    .max(500, "用途は500文字以内で入力してください")
    .regex(controlCharacterFree, "用途に制御文字は使用できません");

const stockExternalProviderIdSchema = z.string().trim().min(1).max(128);

// 連携先アプリ側の ID。Inventia は解釈せず、保存と表示だけを行う
const stockExternalIdSchema = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(controlCharacterFree, "外部IDに制御文字は使用できません");

// 棚卸しは 1 リクエストのロット指定数を上限で抑える。ロット 1 件ごとに
// 書き込みバッチへ statement が増えるため、無制限の入力を受け付けない
const stocktakeLotsSchema = z
    .array(
        z
            .object({
                expiryDate: lotExpiryDateSchema,
                quantity: z.int().min(0),
            })
            .strict(),
    )
    .min(1)
    .max(100);

export const stockAdjustmentSchema = z
    .object({
        delta: z.int().refine((value) => value !== 0, "delta must not be zero"),
        reason: stockMovementReasonSchema,
        // 対象ロットの期限。delta > 0 では加算先（省略時は期限なしロット）、
        // delta < 0 では減算元。delta < 0 で省略した場合は FEFO で自動配分する
        expiryDate: lotExpiryDateSchema.optional(),
        // 対象ロットの直接指定。expiryDate との同時指定はできない
        lotId: lotIdSchema.optional(),
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
        // 用途の自由記述。例「食べ物作成」
        note: stockNoteSchema.optional(),
        // 在庫の行き先になった外部アプリ
        externalProviderId: stockExternalProviderIdSchema.optional(),
        externalId: stockExternalIdSchema.optional(),
    })
    .strict()
    .refine(
        (value) => value.lotId === undefined || value.expiryDate === undefined,
        {
            message: "lotId and expiryDate must not be provided together",
            path: ["lotId"],
        },
    )
    // 連携先が分からない外部 ID は、どのアプリの ID なのか後から辿れず記録として
    // 意味を持たない。DB では ALTER ADD COLUMN の制約でこの関係を CHECK にできないため、
    // 入力の境界で拒否する
    .refine(
        (value) =>
            value.externalId === undefined ||
            value.externalProviderId !== undefined,
        {
            message: "外部IDを指定するときは連携先も指定してください",
            path: ["externalProviderId"],
        },
    );

export const stocktakeSchema = z
    .object({
        // 合計指定。数量 > 0 のロットが 2 件以上ある品目では按分の解釈が
        // 定まらないため拒否し、lots での指定を求める
        quantity: z.int().min(0).optional(),
        // 棚卸し後の全数状態。リストに現れない既存ロットは 0 になる
        lots: stocktakeLotsSchema.optional(),
        occurredAt: stockOccurredAtSchema.optional(),
        idempotencyKey: idempotencyKeySchema,
    })
    .strict()
    .refine(
        (value) =>
            (value.quantity === undefined) !== (value.lots === undefined),
        {
            message: "exactly one of quantity or lots is required",
            path: ["quantity"],
        },
    );

export const stockMovementDtoSchema = z
    .object({
        id: z.string().min(1),
        itemId: z.string().min(1),
        delta: z.int(),
        reason: stockMovementReasonSchema,
        occurredAt: stockOccurredAtSchema,
        idempotencyKey: z.string().min(1).nullable(),
        createdAt: stockOccurredAtSchema,
        // ロット別の内訳。ロット追跡を導入する前に記録された履歴は空配列になる
        allocations: z.array(lotAllocationDtoSchema),
        // 用途の自由記述。記録していない履歴は null
        note: z.string().nullable(),
        // 在庫の行き先になった外部アプリ。記録時点の参照を解決して返す
        externalProvider: externalProviderDtoSchema
            .pick({ id: true, name: true, faviconUrl: true, url: true })
            .nullable(),
        // 連携先アプリ側の ID。Inventia は解釈しない
        externalId: z.string().nullable(),
    })
    .strict();

export const stockOperationResultSchema = z
    .object({
        itemId: z.string().min(1),
        // 操作後に読み取った在庫数量。`lots` と同じ読み取りから導くため、
        // 常に `currentQuantity == sum(lots.quantity)` が成立する
        currentQuantity: z.int().min(0),
        movement: stockMovementDtoSchema.nullable(),
        // この操作で増減したロットの内訳。再送時は記録済み movement の内訳を返す
        allocations: z.array(lotAllocationDtoSchema),
        // 操作後のロット状態（数量 0 のロットは含めない）
        lots: z.array(itemLotDtoSchema),
        replayed: z.boolean(),
    })
    .strict();

export const stockHistoryQuerySchema = z
    .object({
        itemId: z.string().trim().min(1).optional(),
        reason: stockMovementReasonSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
    })
    .strict();

export const stockHistoryResultSchema = z
    .object({
        movements: z.array(stockMovementDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

export const staleStocktakeQuerySchema = z
    .object({
        // 最後の棚卸しからの経過日数のしきい値。0 は「今より前に棚卸しした品目すべて」を意味する
        staleAfterDays: z.coerce.number().int().min(0).max(3650),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().min(1).optional(),
    })
    .strict();

// 棚卸しの movement が 1 件も無い品目は lastStocktakeAt = null になる
export const staleStocktakeItemDtoSchema = itemDtoSchema.extend({
    lastStocktakeAt: z.string().datetime().nullable(),
});

export const staleStocktakeListDtoSchema = z
    .object({
        items: z.array(staleStocktakeItemDtoSchema),
        nextCursor: z.string().nullable(),
    })
    .strict();

const dayInMilliseconds = 24 * 60 * 60 * 1000;

/**
 * 棚卸しが古いと判定する境界時刻。この時刻より前の最終棚卸しだけを古いとみなす
 * （境界と同時刻の棚卸しは古くない）。
 */
export const staleStocktakeThreshold = (
    staleAfterDays: number,
    now: Date = new Date(),
): string =>
    new Date(now.getTime() - staleAfterDays * dayInMilliseconds).toISOString();

/** 在庫操作が対象とするロットの指定方法。`unspecified` の出庫は FEFO で配分する。 */
export type StockLotSelector =
    | { mode: "unspecified" }
    | { mode: "expiry"; expiryDate: string | null }
    | { mode: "lot"; lotId: string };

export interface StockRequestDigestInput {
    kind: StockOperationKind;
    itemId: string;
    reason: StockMovementReason;
    // 入力で省略された occurredAt は自動値のため digest に含めない
    occurredAt: string | null;
    delta: number | null;
    targetQuantity: number | null;
    selector: StockLotSelector;
    lots: readonly LotStocktakeEntry[] | null;
    // 用途と外部連携先。省略した呼び出しは従来と同じ digest になる（下の
    // provenancePart のコメントを参照）
    note?: string | null;
    externalProviderId?: string | null;
    externalId?: string | null;
}

// 値の境界を入力に現れない制御文字で区切り、連結による衝突を避ける
const digestSeparator = "\u001f";

const selectorPart = (selector: StockLotSelector): string => {
    if (selector.mode === "lot") {
        return `lot:${selector.lotId}`;
    }
    if (selector.mode === "expiry") {
        return `expiry:${selector.expiryDate ?? "none"}`;
    }
    return "unspecified";
};

// ロット指定の並び順の違いだけで別リクエスト扱いにしないため、期限で整列してから連結する
const lotsPart = (lots: readonly LotStocktakeEntry[] | null): string =>
    lots === null
        ? ""
        : [...lots]
              .sort((left, right) => {
                  const leftKey = left.expiryDate ?? "";
                  const rightKey = right.expiryDate ?? "";
                  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
              })
              .map((lot) => `${lot.expiryDate ?? "none"}=${lot.quantity}`)
              .join(",");

/**
 * 用途と外部連携先の部分。3 つとも未指定なら null を返し、canonical 文字列へ
 * 何も足さない。
 *
 * 既存の stock_operations.request_digest は用途・連携先を持たないリクエストから
 * 作られている。末尾に常に区切りを足すと canonical 文字列が 1 バイト変わり、
 * 保存済みの digest と一致しなくなって、同じ idempotency key の再送が
 * 「内訳の違うリクエスト」として弾かれてしまう。そのため未指定のときだけは
 * 従来と 1 バイトも変えない。
 */
const provenancePart = (input: StockRequestDigestInput): string | null => {
    const note = input.note ?? null;
    const providerId = input.externalProviderId ?? null;
    const externalId = input.externalId ?? null;
    if (note === null && providerId === null && externalId === null) {
        return null;
    }
    return [
        `note:${note ?? "none"}`,
        `provider:${providerId ?? "none"}`,
        `external:${externalId ?? "none"}`,
    ].join(digestSeparator);
};

const toHex = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

/**
 * 再送リクエストの同一性判定に使う正規化リクエストの SHA-256 hex。
 * ロット指定まで含めるため、同じ idempotency key で内訳の違うリクエストを検出できる。
 */
export const stockRequestDigest = async (
    input: StockRequestDigestInput,
): Promise<string> => {
    const base = [
        input.kind,
        input.itemId,
        input.reason,
        input.occurredAt ?? "auto",
        input.delta === null ? "" : String(input.delta),
        input.targetQuantity === null ? "" : String(input.targetQuantity),
        selectorPart(input.selector),
        lotsPart(input.lots),
    ].join(digestSeparator);
    const provenance = provenancePart(input);
    const canonical =
        provenance === null ? base : `${base}${digestSeparator}${provenance}`;
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
    );
    return toHex(digest);
};

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StocktakeInput = z.infer<typeof stocktakeSchema>;
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;
export type StockOperationResult = z.infer<typeof stockOperationResultSchema>;
export type StockHistoryQuery = z.infer<typeof stockHistoryQuerySchema>;
export type StockHistoryResult = z.infer<typeof stockHistoryResultSchema>;
export type StaleStocktakeQuery = z.infer<typeof staleStocktakeQuerySchema>;
export type StaleStocktakeItemDto = z.infer<typeof staleStocktakeItemDtoSchema>;
export type StaleStocktakeListDto = z.infer<typeof staleStocktakeListDtoSchema>;
