import { z } from "zod";

const normalizeUtcDateTime = (value: string): string =>
    new Date(value).toISOString();

// ロットの期限は保存・API とも ISO 8601 UTC へ正規化する。
// 最短期限を SQL の MIN(expiry_date) で求めるため、辞書順比較が成立する
// 固定書式に揃える必要がある。NULL は「期限なしロット」を表す
export const lotExpiryDateSchema = z.iso
    .datetime({ offset: true })
    .transform(normalizeUtcDateTime)
    .nullable();

// 出力 DTO は保存済みの正規化値を返すため transform を持たない。
// transform を含むスキーマは JSON Schema へ変換できず、MCP の outputSchema に使うと
// tools/list 全体が失敗するため、出力側は書式の検証だけを行う
export const lotExpiryDateOutputSchema = z.string().datetime().nullable();

export const itemLotDtoSchema = z
    .object({
        id: z.string().min(1),
        itemId: z.string().min(1),
        expiryDate: lotExpiryDateOutputSchema,
        quantity: z.int().min(0),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
    })
    .strict();

// delta は 0 にならない（DB の ck_stock_movement_lot_allocations_delta_not_zero と対応）。
// expiryDate は記録時点のロット期限のスナップショットであり、後からロットの期限を
// 変更しても過去の履歴は書き換わらない
export const lotAllocationDtoSchema = z
    .object({
        lotId: z.string().min(1),
        expiryDate: lotExpiryDateOutputSchema,
        delta: z.int().refine((value) => value !== 0, "delta must not be zero"),
    })
    .strict();

export const itemLotListDtoSchema = z
    .object({
        lots: z.array(itemLotDtoSchema),
    })
    .strict();

export const lotUpdateSchema = z
    .object({
        expiryDate: lotExpiryDateSchema,
    })
    .strict();

export const lotListQuerySchema = z.object({
    // 既定は数量 > 0 のロットのみ。数量 0 の行は allocation の参照先として
    // 残るため、履歴目的で全件を見たいときだけ true を指定する
    includeEmpty: z
        .preprocess(
            (value) =>
                value === "true" || value === "1"
                    ? true
                    : value === "false" || value === "0"
                      ? false
                      : value,
            z.boolean(),
        )
        .default(false),
});

export type ItemLotDto = z.infer<typeof itemLotDtoSchema>;
export type LotAllocationDto = z.infer<typeof lotAllocationDtoSchema>;
export type ItemLotListDto = z.infer<typeof itemLotListDtoSchema>;
export type LotUpdateInput = z.infer<typeof lotUpdateSchema>;
export type LotListQuery = z.infer<typeof lotListQuerySchema>;

/** FEFO 配分と期限集計に必要な最小のロット情報。 */
export interface LotSnapshot {
    id: string;
    expiryDate: string | null;
    quantity: number;
}

/** 棚卸しの絶対値指定 1 行。`expiryDate` が null なら期限なしロットを指す。 */
export interface LotStocktakeEntry {
    expiryDate: string | null;
    quantity: number;
}

/** 棚卸し計画 1 行。`quantity` は確定後の絶対値、`delta` は allocation に記録する差分。 */
export interface LotStocktakePlanEntry extends LotStocktakeEntry {
    delta: number;
}

export interface FefoAllocationResult {
    allocations: LotAllocationDto[];
    /** 割り当てきれなかった数量。0 より大きいなら在庫不足である。 */
    shortage: number;
}

export type TotalStocktakeTarget =
    | { resolved: true; expiryDate: string | null }
    | { resolved: false };

// 期限なしロットは常に最後に扱うため、比較用に固定の順位を与える
const expiryRank = (expiryDate: string | null): number =>
    expiryDate === null ? 1 : 0;

const compareExpiryDates = (
    left: string | null,
    right: string | null,
): number => {
    const rankDifference = expiryRank(left) - expiryRank(right);
    if (rankDifference !== 0) {
        return rankDifference;
    }
    if (left === null || right === null) {
        return 0;
    }
    return left < right ? -1 : left > right ? 1 : 0;
};

// 期限なしロットの期限値 null は Map のキーにできる文字列へ写す。
// 空文字列は ISO 8601 の値になり得ないため衝突しない
const expiryKey = (expiryDate: string | null): string => expiryDate ?? "";

/** 期限昇順・期限なし最後・同期限は id 昇順で FEFO 順に並べ替える。 */
export const sortLotsFefo = <T extends LotSnapshot>(lots: readonly T[]): T[] =>
    [...lots].sort((left, right) => {
        const byExpiry = compareExpiryDates(left.expiryDate, right.expiryDate);
        if (byExpiry !== 0) {
            return byExpiry;
        }
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

/**
 * FEFO で出庫量を貪欲に割り当てる。`quantity` は正の出庫量で、返す delta は負値である。
 * 数量 0 のロットは配分対象にしない。
 */
export const allocateFefo = (
    lots: readonly LotSnapshot[],
    quantity: number,
): FefoAllocationResult => {
    if (quantity <= 0) {
        return { allocations: [], shortage: 0 };
    }
    const allocations: LotAllocationDto[] = [];
    let remaining = quantity;
    for (const lot of sortLotsFefo(lots)) {
        if (remaining === 0) {
            break;
        }
        if (lot.quantity <= 0) {
            continue;
        }
        const taken = Math.min(lot.quantity, remaining);
        allocations.push({
            lotId: lot.id,
            expiryDate: lot.expiryDate,
            delta: -taken,
        });
        remaining -= taken;
    }
    return { allocations, shortage: remaining };
};

/**
 * 絶対値指定の棚卸しから差分計画を作る。
 * 棚卸しは全数確定であるため、リクエストに現れない既存ロットは 0 にする。
 * 既存ロットは差分 0 でも計画に含める。読み取り後に合計を変えずに内訳だけが
 * 動いた場合（ロットの期限変更など）でも、指定した絶対値へ確定させる必要がある。
 * 差分 0 の行は allocation を作れないため、記録は呼び出し側で差分 0 を除いて行う。
 */
export const planStocktakeLots = (
    currentLots: readonly LotSnapshot[],
    requestedLots: readonly LotStocktakeEntry[],
): LotStocktakePlanEntry[] => {
    const currentByExpiry = new Map<string, LotSnapshot>();
    for (const lot of currentLots) {
        currentByExpiry.set(expiryKey(lot.expiryDate), lot);
    }
    const requestedKeys = new Set<string>();
    const plan: LotStocktakePlanEntry[] = [];
    for (const requested of requestedLots) {
        const key = expiryKey(requested.expiryDate);
        requestedKeys.add(key);
        const current = currentByExpiry.get(key);
        // 存在しない期限へ 0 を指定した場合は空のロット行を作らない
        if (current === undefined && requested.quantity === 0) {
            continue;
        }
        plan.push({
            expiryDate: requested.expiryDate,
            quantity: requested.quantity,
            delta: requested.quantity - (current?.quantity ?? 0),
        });
    }
    for (const lot of currentLots) {
        if (
            requestedKeys.has(expiryKey(lot.expiryDate)) ||
            lot.quantity === 0
        ) {
            continue;
        }
        plan.push({
            expiryDate: lot.expiryDate,
            quantity: 0,
            delta: -lot.quantity,
        });
    }
    return plan.sort((left, right) =>
        compareExpiryDates(left.expiryDate, right.expiryDate),
    );
};

/** 数量 > 0 のロットのうち最も早い期限。期限付きの在庫がなければ null。 */
export const earliestExpiryDate = (
    lots: readonly LotSnapshot[],
): string | null => {
    let earliest: string | null = null;
    for (const lot of lots) {
        if (lot.quantity <= 0 || lot.expiryDate === null) {
            continue;
        }
        if (earliest === null || lot.expiryDate < earliest) {
            earliest = lot.expiryDate;
        }
    }
    return earliest;
};

/** 同一期限の重複指定を検出する。棚卸しの `lots` は期限ごとに 1 行でなければならない。 */
export const findDuplicateExpiryDate = (
    entries: readonly LotStocktakeEntry[],
): { expiryDate: string | null } | null => {
    const seen = new Set<string>();
    for (const entry of entries) {
        const key = expiryKey(entry.expiryDate);
        if (seen.has(key)) {
            return { expiryDate: entry.expiryDate };
        }
        seen.add(key);
    }
    return null;
};

/**
 * 合計値だけの棚卸しをどのロットへ適用するかを決める。
 * 数量 > 0 のロットが 2 件以上ある品目は按分の解釈が定まらないため未解決を返し、
 * 呼び出し側が期限ごとの指定を促す。
 */
export const resolveTotalStocktakeTarget = (
    lots: readonly LotSnapshot[],
): TotalStocktakeTarget => {
    const stocked = lots.filter((lot) => lot.quantity > 0);
    if (stocked.length > 1) {
        return { resolved: false };
    }
    // 在庫のあるロットがない場合は期限なしロットへ計上する。数量 0 で残っている
    // ロットの期限を引き継ぐと、数え直した在庫が過去の期限を持つことになる
    return { resolved: true, expiryDate: stocked[0]?.expiryDate ?? null };
};
