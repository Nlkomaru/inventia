import type {
    ReceiptApplyInput,
    ReceiptApplyLineInput,
    ReceiptExpiryConfidence,
    ReceiptExpirySource,
    ReceiptLineDto,
    ReceiptMatchMethodValue,
} from "@/domain/receipt";

// 確認画面のフォーム状態と、承認内容（ReceiptApplyInput）への変換。
// binding・React・zod へ依存させず、`node --experimental-strip-types` で
// 境界値を実行確認できる状態を保つ（型は import type のみ）。

export type ReceiptReviewAction = ReceiptApplyLineInput["action"];
export type ReceiptReviewExpiryMode = "date" | "none";
type ReceiptApplyNewItem = NonNullable<ReceiptApplyLineInput["newItem"]>;
type ReceiptBaseDimension = NonNullable<ReceiptApplyNewItem["baseDimension"]>;

/** 数量は在庫調整の入力上限に合わせる（domain の receiptApplyLineSchema と同じ値）。 */
export const reviewQuantityMax = 100_000;
/** 品目名の上限。レシート表記をそのまま初期値にするため、ここで丸める。 */
export const reviewItemNameMax = 200;

export interface ReceiptReviewNewItemForm {
    name: string;
    categoryId: string;
    locationId: string;
    baseUnit: string;
    baseDimension: ReceiptBaseDimension | "";
    memo: string;
}

export interface ReceiptReviewRow {
    lineId: string;
    lineNo: number;
    /** レシートの印字そのまま。紙との突き合わせと表記辞書の見出しに使う。 */
    rawName: string;
    /** ※ などを除いて整えた表示名。印字のままで良い行は rawName と同じ。 */
    displayName: string;
    /** 反映方法。既定は照合済みなら既存品目へ加算、未照合ならスキップ。 */
    action: ReceiptReviewAction;
    /** action = add_to_item のときの反映先品目 ID。 */
    itemId: string;
    quantity: string;
    /** 空文字は「金額なし」を表す。0 は 0 円として送る。 */
    price: string;
    expiryMode: ReceiptReviewExpiryMode;
    /** yyyy-mm-dd。expiryMode = none のときは送らない。 */
    expiryDate: string;
    registerAlias: boolean;
    newItem: ReceiptReviewNewItemForm;
}

export const expirySourceLabels: Record<ReceiptExpirySource, string> = {
    printed: "レシートの印字",
    estimated: "AI の推測",
    unknown: "不明",
};

export const expiryConfidenceLabels: Record<ReceiptExpiryConfidence, string> = {
    high: "確度: 高",
    medium: "確度: 中",
    low: "確度: 低",
};

export const matchMethodLabels: Record<ReceiptMatchMethodValue, string> = {
    exact: "品目名の完全一致",
    alias: "登録済みの表記",
    similarity: "名前の類似",
    manual: "手動で指定",
};

export const actionLabels: Record<ReceiptReviewAction, string> = {
    add_to_item: "既存の品目へ加算",
    create_item: "品目を新規作成",
    skip: "この行は取り込まない",
};

// 解析が返した提案を初期値にする。保管場所はレシートから決まらないため空のまま
const suggestedNewItem = (line: ReceiptLineDto): ReceiptReviewNewItemForm => ({
    name: (line.completedName ?? line.rawName)
        .trim()
        .slice(0, reviewItemNameMax),
    categoryId: line.suggestedCategoryId ?? "",
    locationId: "",
    baseUnit: line.suggestedBaseUnit ?? "",
    baseDimension: line.suggestedBaseDimension ?? "",
    memo: "",
});

/**
 * 既定の反映方法。照合済みなら既存品目へ加算、未照合でも在庫に置く品物なら
 * 新規作成を既定にする。レジ袋や送料のように在庫へ置かない行はスキップにする。
 */
const resolveInitialAction = (line: ReceiptLineDto): ReceiptReviewAction => {
    if (line.matchedItemId !== null) {
        return "add_to_item";
    }
    return line.stockRelevant ? "create_item" : "skip";
};

/**
 * 明細 1 行分の初期フォーム状態。
 * 類似度だけで自動確定しないため、照合が確定していない行は既存品目へ加算しない。
 */
export const createReviewRow = (line: ReceiptLineDto): ReceiptReviewRow => ({
    lineId: line.id,
    lineNo: line.lineNo,
    rawName: line.rawName,
    displayName: line.completedName ?? line.rawName,
    action: resolveInitialAction(line),
    itemId: line.matchedItemId ?? "",
    quantity: String(line.quantity),
    price: line.price === null ? "" : String(line.price),
    expiryMode: line.suggestedExpiryDate === null ? "none" : "date",
    expiryDate: line.suggestedExpiryDate ?? "",
    registerAlias: true,
    newItem: suggestedNewItem(line),
});

export const createReviewRows = (
    lines: readonly ReceiptLineDto[],
): ReceiptReviewRow[] => lines.map(createReviewRow);

export const patchReviewRow = (
    rows: readonly ReceiptReviewRow[],
    lineId: string,
    patch: Partial<ReceiptReviewRow>,
): ReceiptReviewRow[] =>
    rows.map((row) => (row.lineId === lineId ? { ...row, ...patch } : row));

export const patchReviewRowNewItem = (
    rows: readonly ReceiptReviewRow[],
    lineId: string,
    patch: Partial<ReceiptReviewNewItemForm>,
): ReceiptReviewRow[] =>
    rows.map((row) =>
        row.lineId === lineId
            ? { ...row, newItem: { ...row.newItem, ...patch } }
            : row,
    );

/** 1 以上 reviewQuantityMax 以下の整数だけを受け付ける。読めない値は null。 */
export const parseReviewQuantity = (value: string): number | null => {
    const trimmed = value.trim();
    if (!/^\d+$/u.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) return null;
    return parsed >= 1 && parsed <= reviewQuantityMax ? parsed : null;
};

export type ReviewPriceParseResult =
    | { ok: true; value: number | null }
    | { ok: false };

/** 空欄は「金額なし」(null)。0 は 0 円として通す。 */
export const parseReviewPrice = (value: string): ReviewPriceParseResult => {
    const trimmed = value.trim();
    if (trimmed === "") return { ok: true, value: null };
    if (!/^\d+$/u.test(trimmed)) return { ok: false };
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) return { ok: false };
    return { ok: true, value: parsed };
};

/** yyyy-mm-dd の実在する暦日だけを受け付ける（2026-02-30 は不可）。 */
export const isValidIsoDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
};

export interface ReceiptReviewTotals {
    /** 全明細の合計。レシート記載の合計との突き合わせに使う。 */
    lineTotal: number | null;
    /** 実際に反映する行だけの合計。 */
    appliedTotal: number | null;
    /** 金額が空欄の明細数。1 件でもあれば合計を出せない。 */
    missingPriceCount: number;
    skippedCount: number;
    hasInvalidPrice: boolean;
}

export const summarizeReviewTotals = (
    rows: readonly ReceiptReviewRow[],
): ReceiptReviewTotals => {
    let lineTotal: number | null = 0;
    let appliedTotal: number | null = 0;
    let missingPriceCount = 0;
    let skippedCount = 0;
    let hasInvalidPrice = false;
    for (const row of rows) {
        const applied = row.action !== "skip";
        if (!applied) skippedCount += 1;
        const parsed = parseReviewPrice(row.price);
        if (!parsed.ok) {
            hasInvalidPrice = true;
            lineTotal = null;
            if (applied) appliedTotal = null;
            continue;
        }
        if (parsed.value === null) {
            missingPriceCount += 1;
            lineTotal = null;
            if (applied) appliedTotal = null;
            continue;
        }
        if (lineTotal !== null) lineTotal += parsed.value;
        if (applied && appliedTotal !== null) appliedTotal += parsed.value;
    }
    return {
        lineTotal,
        appliedTotal,
        missingPriceCount,
        skippedCount,
        hasInvalidPrice,
    };
};

export type ReceiptReviewField =
    | "itemId"
    | "quantity"
    | "price"
    | "expiryDate"
    | "newItemName"
    | "newItemCategoryId"
    | "newItemLocationId"
    | "newItemBaseUnit"
    | "newItemBaseDimension";

export interface ReceiptReviewIssue {
    lineId: string;
    field: ReceiptReviewField;
    message: string;
}

export const validateReviewRow = (
    row: ReceiptReviewRow,
): ReceiptReviewIssue[] => {
    const issues: ReceiptReviewIssue[] = [];
    const add = (field: ReceiptReviewField, message: string) => {
        issues.push({ lineId: row.lineId, field, message });
    };
    if (row.action === "skip") return issues;
    if (row.action === "add_to_item" && row.itemId.trim() === "") {
        add("itemId", "反映先の品目を選択してください");
    }
    if (row.action === "create_item") {
        const { newItem } = row;
        if (newItem.name.trim() === "") {
            add("newItemName", "品目名を入力してください");
        } else if (newItem.name.trim().length > reviewItemNameMax) {
            add("newItemName", `品目名は${reviewItemNameMax}文字以内です`);
        }
        if (newItem.categoryId.trim() === "") {
            add("newItemCategoryId", "カテゴリを選択してください");
        }
        if (newItem.locationId.trim() === "") {
            add("newItemLocationId", "保管場所を選択してください");
        }
        // 基準単位と次元は片方だけでは登録できない
        const hasUnit = newItem.baseUnit.trim() !== "";
        const hasDimension = newItem.baseDimension !== "";
        if (hasUnit !== hasDimension) {
            if (!hasUnit) {
                add("newItemBaseUnit", "基準単位も入力してください");
            } else {
                add("newItemBaseDimension", "数量の次元も選択してください");
            }
        }
    }
    if (parseReviewQuantity(row.quantity) === null) {
        add(
            "quantity",
            `数量は1以上${reviewQuantityMax.toLocaleString("en-US")}以下の整数で入力してください`,
        );
    }
    if (!parseReviewPrice(row.price).ok) {
        add("price", "金額は0以上の整数で入力するか、空欄にしてください");
    }
    if (row.expiryMode === "date" && !isValidIsoDate(row.expiryDate)) {
        add(
            "expiryDate",
            "期限を年月日で入力するか、「期限なし」を選択してください",
        );
    }
    return issues;
};

export const validateReviewRows = (
    rows: readonly ReceiptReviewRow[],
): ReceiptReviewIssue[] => rows.flatMap(validateReviewRow);

/** 行 ID と項目から引ける形へ畳む。入力欄の aria-describedby と表示に使う。 */
export const indexReviewIssues = (
    issues: readonly ReceiptReviewIssue[],
): Map<string, Partial<Record<ReceiptReviewField, string>>> => {
    const index = new Map<
        string,
        Partial<Record<ReceiptReviewField, string>>
    >();
    for (const issue of issues) {
        const current = index.get(issue.lineId) ?? {};
        if (current[issue.field] === undefined) {
            current[issue.field] = issue.message;
            index.set(issue.lineId, current);
        }
    }
    return index;
};

const buildNewItem = (form: ReceiptReviewNewItemForm): ReceiptApplyNewItem => {
    const baseUnit = form.baseUnit.trim();
    const memo = form.memo.trim();
    return {
        name: form.name.trim(),
        categoryId: form.categoryId.trim(),
        locationId: form.locationId.trim(),
        // 単位と次元は両方そろったときだけ送る（片方だけは schema が拒否する）
        ...(baseUnit !== "" && form.baseDimension !== ""
            ? { baseUnit, baseDimension: form.baseDimension }
            : {}),
        ...(memo === "" ? {} : { memo }),
    };
};

/**
 * 承認済みの行を反映入力へ変換する。
 * action ごとに送るキーを変え、前の選択の残骸（itemId / newItem）を持ち越さない。
 * 期限は省略時の既定に頼らず常に明示して送る（画面の表示と反映結果を一致させる）。
 */
export const buildApplyLine = (
    row: ReceiptReviewRow,
): ReceiptApplyLineInput | null => {
    if (row.action === "skip") {
        return { lineId: row.lineId, action: "skip", registerAlias: false };
    }
    const quantity = parseReviewQuantity(row.quantity);
    const price = parseReviewPrice(row.price);
    if (quantity === null || !price.ok) return null;
    if (row.expiryMode === "date" && !isValidIsoDate(row.expiryDate)) {
        return null;
    }
    const expiryDate = row.expiryMode === "none" ? null : row.expiryDate;
    const common = {
        lineId: row.lineId,
        quantity,
        price: price.value,
        expiryDate,
        registerAlias: row.registerAlias,
    };
    if (row.action === "add_to_item") {
        const itemId = row.itemId.trim();
        if (itemId === "") return null;
        return { ...common, action: "add_to_item", itemId };
    }
    return {
        ...common,
        action: "create_item",
        newItem: buildNewItem(row.newItem),
    };
};

export interface BuildApplyInputParams {
    idempotencyKey: string;
    /** レシートから読めた店舗名。null のときは入力が必須になる。 */
    receiptStoreName: string | null;
    /**
     * 購入が既に記録済みか。部分的に反映されたレシートの再送では
     * 店舗名は最初の反映で確定しているため、入力を求め直さない。
     */
    purchaseRecorded: boolean;
    storeNameInput: string;
    note: string;
    rows: readonly ReceiptReviewRow[];
}

export type BuildApplyInputResult =
    | { ok: true; input: ReceiptApplyInput }
    | {
          ok: false;
          issues: ReceiptReviewIssue[];
          storeNameError: string | null;
      };

export const buildApplyInput = ({
    idempotencyKey,
    receiptStoreName,
    purchaseRecorded,
    storeNameInput,
    note,
    rows,
}: BuildApplyInputParams): BuildApplyInputResult => {
    const issues = validateReviewRows(rows);
    const storeName = storeNameInput.trim();
    // purchases.source は NOT NULL のため、レシートから読めなかった場合だけ入力を求める
    const storeNameError =
        receiptStoreName === null && storeName === "" && !purchaseRecorded
            ? "レシートから店舗名を読み取れませんでした。店舗名を入力してください"
            : null;
    if (issues.length > 0 || storeNameError !== null || rows.length === 0) {
        return { ok: false, issues, storeNameError };
    }
    const lines: ReceiptApplyLineInput[] = [];
    for (const row of rows) {
        const line = buildApplyLine(row);
        // validate を通った行は必ず変換できる。保険として未変換の行は失敗にする
        if (line === null) {
            return {
                ok: false,
                issues: [
                    {
                        lineId: row.lineId,
                        field: "quantity",
                        message: "入力内容を確認してください",
                    },
                ],
                storeNameError: null,
            };
        }
        lines.push(line);
    }
    const trimmedNote = note.trim();
    return {
        ok: true,
        input: {
            idempotencyKey,
            ...(storeName === "" ? {} : { storeName }),
            ...(trimmedNote === "" ? {} : { note: trimmedNote }),
            lines,
        },
    };
};

/**
 * 反映の idempotency key。レシート 1 枚は 1 回だけ反映されるため、
 * レシート ID から決める。入力を直した再送や画面の再読み込みでも同じ値になり、
 * 適用済みの行が再計上されない（サーバー側も最初に使われた key へ収束させる）。
 */
export const receiptApplyIdempotencyKey = (receiptId: string): string =>
    `receipt-apply:${receiptId}`;
