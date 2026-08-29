import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, stepCountIs, type ToolSet } from "ai";
import type { CategoryDto } from "../domain/category";
import { newId } from "../domain/id";
import { normalizeContentAmount } from "../domain/price";
import {
    decodeReceiptCursor,
    encodeReceiptCursor,
    normalizeSuggestedBaseUnit,
    type ReceiptApplyInput,
    type ReceiptApplyLineInput,
    type ReceiptApplyLineResult,
    type ReceiptApplyResult,
    type ReceiptBaseDimension,
    type ReceiptDetailDto,
    type ReceiptDto,
    type ReceiptExampleDto,
    type ReceiptExampleListDto,
    type ReceiptLineDto,
    type ReceiptListDto,
    receiptApplyInputSchema,
    receiptApplyQuantityMax,
    receiptCompletedNameMaxLength,
    receiptContentTypeExtensions,
    receiptContentTypeSchema,
    receiptExampleQuerySchema,
    receiptListQuerySchema,
    receiptMaxByteSize,
    receiptOcrResultSchema,
    receiptParseInstructionsWithCategories,
    receiptTaxIncludedPrice,
} from "../domain/receipt";
import {
    buildReceiptMatchIndex,
    matchLine,
    normalizeReceiptLineExpiry,
    normalizeReceiptName,
    type ReceiptMatchCandidate,
    type ReceiptMatchSource,
    receiptExpiryDateToLotExpiry,
    receiptLocalDateTimeToUtc,
    resolveLineExpiry,
} from "../domain/receipt-match";
import { insertPriceRecord } from "../repositories/priceRepository";
import {
    claimReceiptPurchase,
    deleteReceipt as deleteReceiptRow,
    findPurchaseById,
    findPurchaseByIdempotencyKey,
    findReceipt,
    type ItemPricingRow,
    insertItemAliasIfAbsent,
    insertReceipt,
    listAppliedReceiptLineExamples,
    listItemAliasesByNormalizedNames,
    listItemNamesByIds,
    listItemPricingContexts,
    listMatchableItems,
    listReceiptLines,
    listReceipts as listReceiptRows,
    markReceiptApplied,
    type PurchaseRow,
    purchaseBelongsToOtherReceipt,
    type ReceiptExampleRow,
    type ReceiptLineRow,
    type ReceiptLineWrite,
    type ReceiptRow,
    recordReceiptLineApplied,
    reserveReceiptLineItemId,
    saveReceiptParseResult,
    setReceiptLineMatch,
    updateReceiptLineMatches,
    updateReceiptStatus,
} from "../repositories/receiptRepository";
import { listCategoryTree } from "./categoryService";
import {
    getOpenRouterApiKey,
    getOpenRouterIntegrationStatus,
} from "./integrationService";
import { type ItemSearchEnv, indexItems } from "./itemSearchService";
import { createItem, ItemServiceError } from "./itemService";
import { adjustStock, StockServiceError } from "./stockService";
import type { StoreSearchEnv } from "./storeSearchService";
import { resolveStoreByName } from "./storeService";

export type ReceiptServiceErrorCode =
    | "RECEIPT_INVALID_INPUT"
    | "RECEIPT_INVALID_CURSOR"
    | "RECEIPT_UNSUPPORTED_MEDIA_TYPE"
    | "RECEIPT_TOO_LARGE"
    | "RECEIPT_NOT_FOUND"
    | "RECEIPT_ITEM_NOT_FOUND"
    | "RECEIPT_INVALID_STATE"
    | "RECEIPT_APPLY_CONFLICT"
    | "RECEIPT_STORAGE_ERROR";

const statusByCode: Record<
    ReceiptServiceErrorCode,
    400 | 404 | 409 | 413 | 415 | 503
> = {
    RECEIPT_INVALID_INPUT: 400,
    RECEIPT_INVALID_CURSOR: 400,
    RECEIPT_UNSUPPORTED_MEDIA_TYPE: 415,
    RECEIPT_TOO_LARGE: 413,
    RECEIPT_NOT_FOUND: 404,
    RECEIPT_ITEM_NOT_FOUND: 404,
    RECEIPT_INVALID_STATE: 409,
    RECEIPT_APPLY_CONFLICT: 409,
    RECEIPT_STORAGE_ERROR: 503,
};

export class ReceiptServiceError extends Error {
    readonly status: 400 | 404 | 409 | 413 | 415 | 503;

    constructor(
        readonly code: ReceiptServiceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "ReceiptServiceError";
        this.status = statusByCode[code];
    }
}

/**
 * レシート取込が必要とする binding だけの構造型。`Env` はこの形へ代入できる。
 * service を Cloudflare の生成型へ固定しないことで、検証用のスタブを渡せる。
 */
export interface ReceiptEnv {
    DB: D1Database;
    RECEIPTS: R2Bucket;
    SETTINGS_ENCRYPTION_KEY: string;
}

/** 類似度候補の母集合の上限。これを超える品目数では候補提示が一部欠ける。 */
export const receiptMatchItemLimit = 2000;

/** 解析全体のタイムアウト。リトライを含めてこの時間で打ち切る。 */
export const receiptParseTimeoutMs = 60_000;

// 上流の例外文字列・API 応答・API key を保存も返却もしないため、
// 失敗理由は利用者が次に取れる行動を書いた固定文へ写す
const parseFailureMessages = {
    notConfigured: "OpenRouter API key を連携設定から保存してください。",
    imageMissing:
        "レシート画像を読み込めませんでした。もう一度アップロードしてください。",
    provider:
        "レシートを解析できませんでした。時間をおいて再試行してください。",
    timeout:
        "レシートの解析が時間内に終わりませんでした。もう一度実行してください。",
    malformed:
        "レシートの内容を読み取れませんでした。明るい場所で全体が入るように撮り直してから再解析してください。",
} as const;

/**
 * 解析失敗の切り分け情報を運用ログにだけ残す。利用者向けメッセージは
 * 固定文のままにし、記録も返却もしない上流の理由をここで観測できるようにする。
 * 画像・明細・API key は出さず、失敗の種類が分かる値に限る。
 */
const logParseFailure = (receiptId: string, error: unknown): void => {
    console.error("receipt parse failed", {
        receiptId,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
    });
};

class ReceiptParseFailure extends Error {
    constructor(readonly userMessage: string) {
        super("receipt parse failed");
        this.name = "ReceiptParseFailure";
    }
}

// AI SDK は失敗の種類を name で区別できる。出力の検証失敗と上流障害は
// 利用者の次の行動が違うため分けて写す
const malformedOutputErrorNames = new Set([
    "AI_NoObjectGeneratedError",
    "AI_NoOutputGeneratedError",
    "AI_TypeValidationError",
    "AI_JSONParseError",
]);

const timeoutErrorNames = new Set(["TimeoutError", "AbortError"]);

const toParseFailureMessage = (error: unknown): string => {
    if (error instanceof ReceiptParseFailure) {
        return error.userMessage;
    }
    if (error instanceof Error) {
        if (malformedOutputErrorNames.has(error.name)) {
            return parseFailureMessages.malformed;
        }
        if (timeoutErrorNames.has(error.name)) {
            return parseFailureMessages.timeout;
        }
    }
    return parseFailureMessages.provider;
};

const invalidInput = (message: string): ReceiptServiceError =>
    new ReceiptServiceError("RECEIPT_INVALID_INPUT", message);

const validationMessage = (
    issues: readonly { message: string; path: PropertyKey[] }[],
): string =>
    issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join(", ");

const requireReceipt = async (
    db: D1Database,
    id: string,
): Promise<ReceiptRow> => {
    if (id.trim().length === 0) {
        throw invalidInput("レシート ID を指定してください。");
    }
    const row = await findReceipt(db, id);
    if (!row) {
        throw new ReceiptServiceError(
            "RECEIPT_NOT_FOUND",
            "レシートが見つかりません。",
        );
    }
    return row;
};

const toReceiptDto = (row: ReceiptRow): ReceiptDto => ({
    id: row.id,
    status: row.status,
    contentType: row.contentType,
    byteSize: row.byteSize,
    storeName: row.storeName,
    purchasedAt: row.purchasedAt,
    totalPrice: row.totalPrice,
    model: row.model,
    errorMessage: row.errorMessage,
    purchaseId: row.purchaseId,
    appliedAt: row.appliedAt,
    lineCount: row.lineCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

// 保存列は 1 行に平たく並ぶが、公開する DTO は期限・提案・照合・反映実績の 4 つに
// 束ねる。期限の由来と日付、単位と量の種類のように、片方だけを読むと意味を誤る
// 組み合わせを同じ入れ物へ置く
const toLineDto = (
    row: ReceiptLineRow,
    matchedItemName: string | null,
    candidates: ReceiptMatchCandidate[],
): ReceiptLineDto => ({
    id: row.id,
    lineNo: row.lineNo,
    rawName: row.rawName,
    completedName: row.completedName,
    normalizedName: row.normalizedName,
    quantity: row.quantity,
    price: row.price,
    stockRelevant: row.stockRelevant,
    expiry: {
        printedDate: row.printedExpiryDate,
        estimatedDate: row.estimatedExpiryDate,
        source: row.expirySource,
        confidence: row.expiryConfidence,
        estimateReason: row.expiryReason,
        suggestedDate: resolveLineExpiry(row),
    },
    suggestion: {
        categoryId: row.suggestedCategoryId,
        categoryName: row.suggestedCategoryName,
        baseUnit: row.suggestedBaseUnit,
        baseDimension: row.suggestedBaseDimension,
    },
    match: {
        itemId: row.matchedItemId,
        itemName: matchedItemName,
        method: row.matchMethod,
        score: row.matchScore,
        candidates,
    },
    // 反映で書かれた列がひとつも無い行は「まだ記録が無い」ため、
    // 空の入れ物ではなく null にして解析値へフォールバックさせる
    applied:
        row.appliedAction === null
            ? null
            : {
                  action: row.appliedAction,
                  quantity: row.appliedQuantity,
                  baseUnit: row.appliedBaseUnit,
                  price: row.appliedPrice,
                  expiryDate: row.appliedExpiryDate,
                  appliedAt: row.appliedAt,
              },
});

// 金額を読めない行が 1 つでもあれば合計は出せない。0 を代入して
// レシート記載の合計と突き合わせられる数字に見せない
const linesTotalPrice = (rows: readonly ReceiptLineRow[]): number | null => {
    if (rows.length === 0) {
        return null;
    }
    let total = 0;
    for (const row of rows) {
        if (row.price === null) {
            return null;
        }
        total += row.price;
    }
    return total;
};

// 記録できた金額だけを足す。linesTotalPrice と違い「1 行でも欠ければ null」に
// しないのは、金額のない行や取り込まなかった行があっても「実際に支出として
// 記録した額」は確定しているため。1 行も記録が無いときだけ null にする
const appliedTotalPrice = (rows: readonly ReceiptLineRow[]): number | null => {
    let total: number | null = null;
    for (const row of rows) {
        if (row.appliedPrice === null) {
            continue;
        }
        total = (total ?? 0) + row.appliedPrice;
    }
    return total;
};

/**
 * 明細と照合候補つきのレシートを返す。候補は保存せず読み取り時に計算する
 * （候補は承認までの一時情報で、確定した照合だけが receipt_lines に残る）。
 * 品目一覧とエイリアス辞書はそれぞれ 1 クエリで読み、行ごとに問い合わせない。
 */
export const getReceipt = async (
    db: D1Database,
    id: string,
): Promise<ReceiptDetailDto> => {
    const receipt = await requireReceipt(db, id);
    const lines = await listReceiptLines(db, id);
    if (lines.length === 0) {
        return {
            ...toReceiptDto(receipt),
            lines: [],
            linesTotalPrice: null,
            appliedTotalPrice: null,
        };
    }
    const unmatched = lines.filter((line) => line.matchedItemId === null);
    const matchedItemIds = [
        ...new Set(
            lines
                .map((line) => line.matchedItemId)
                .filter((itemId): itemId is string => itemId !== null),
        ),
    ];
    const [items, aliases, matchedNames] = await Promise.all([
        unmatched.length > 0
            ? listMatchableItems(db, receiptMatchItemLimit)
            : Promise.resolve([]),
        unmatched.length > 0
            ? listItemAliasesByNormalizedNames(db, [
                  ...new Set(unmatched.map((line) => line.normalizedName)),
              ])
            : Promise.resolve(new Map<string, string>()),
        listItemNamesByIds(db, matchedItemIds),
    ]);
    const index = buildReceiptMatchIndex(
        items.map((item) => ({ id: item.id, name: item.name })),
    );
    return {
        ...toReceiptDto(receipt),
        lines: lines.map((line) =>
            toLineDto(
                line,
                line.matchedItemId === null
                    ? null
                    : (matchedNames.get(line.matchedItemId) ?? null),
                line.matchedItemId !== null
                    ? []
                    : matchLine(line.normalizedName, {
                          exact: index.exact,
                          aliases,
                          candidates: index.candidates,
                      }).candidates,
            ),
        ),
        linesTotalPrice: linesTotalPrice(lines),
        appliedTotalPrice: appliedTotalPrice(lines),
    };
};

export const listReceipts = async (
    db: D1Database,
    input: unknown,
): Promise<ReceiptListDto> => {
    const parsed = receiptListQuerySchema.safeParse(input);
    if (!parsed.success) {
        throw invalidInput(validationMessage(parsed.error.issues));
    }
    const cursor = parsed.data.cursor
        ? decodeReceiptCursor(parsed.data.cursor)
        : null;
    if (parsed.data.cursor && !cursor) {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_CURSOR",
            "一覧の cursor が不正です。最初のページから読み直してください。",
        );
    }
    const page = await listReceiptRows(db, {
        status: parsed.data.status ?? null,
        limit: parsed.data.limit,
        cursor,
    });
    const receipts = page.rows.map(toReceiptDto);
    const last = receipts.at(-1);
    return {
        receipts,
        nextCursor:
            page.hasMore && last
                ? encodeReceiptCursor({
                      createdAt: last.createdAt,
                      id: last.id,
                  })
                : null,
    };
};

/**
 * 保存済みのレシート画像を読み出す。本文はストリームのまま返し、Worker が
 * 画像全体をメモリへ載せないようにする。R2 のオブジェクトキーは公開しないため、
 * 呼び出し側はレシート ID だけで画像を参照する。
 */
export const getReceiptImage = async (
    env: ReceiptEnv,
    id: string,
): Promise<{
    body: ReadableStream;
    contentType: string;
    byteSize: number;
    etag: string;
}> => {
    const receipt = await requireReceipt(env.DB, id);
    const object = await env.RECEIPTS.get(receipt.objectKey);
    if (!object) {
        throw new ReceiptServiceError(
            "RECEIPT_NOT_FOUND",
            "レシート画像が見つかりません。取り込み直してください。",
        );
    }
    return {
        body: object.body,
        contentType: receipt.contentType,
        byteSize: receipt.byteSize,
        etag: object.httpEtag,
    };
};

/**
 * レシート画像を R2 へ保存し、`uploaded` のレシートを作る。
 * content-type は許可リストで判定し、上限サイズを超える入力は R2 へ書く前に拒否する。
 */
export const uploadReceipt = async (
    env: ReceiptEnv,
    input: { bytes: ArrayBuffer | Uint8Array; contentType: string },
): Promise<ReceiptDto> => {
    const contentType = receiptContentTypeSchema.safeParse(
        input.contentType.split(";")[0]?.trim().toLowerCase() ?? "",
    );
    if (!contentType.success) {
        throw new ReceiptServiceError(
            "RECEIPT_UNSUPPORTED_MEDIA_TYPE",
            "対応していない画像形式です。JPEG、PNG、WebP のいずれかでアップロードしてください。",
        );
    }
    const byteSize = input.bytes.byteLength;
    if (byteSize === 0) {
        throw invalidInput("空のファイルはアップロードできません。");
    }
    if (byteSize > receiptMaxByteSize) {
        throw new ReceiptServiceError(
            "RECEIPT_TOO_LARGE",
            "画像サイズが 10 MiB を超えています。解像度を下げて撮り直してください。",
        );
    }
    const id = newId();
    const objectKey = `receipts/${id}.${receiptContentTypeExtensions[contentType.data]}`;
    try {
        await env.RECEIPTS.put(objectKey, input.bytes, {
            httpMetadata: { contentType: contentType.data },
        });
    } catch {
        throw new ReceiptServiceError(
            "RECEIPT_STORAGE_ERROR",
            "レシート画像を保存できませんでした。時間をおいて再試行してください。",
        );
    }
    try {
        return toReceiptDto(
            await insertReceipt(env.DB, {
                id,
                objectKey,
                contentType: contentType.data,
                byteSize,
            }),
        );
    } catch (error) {
        // 参照されないオブジェクトを残さない。削除に失敗しても元の失敗を返す
        await env.RECEIPTS.delete(objectKey).catch(() => undefined);
        throw error;
    }
};

/** 補完名は rawName と同じ値・空文字を保存しない。表記辞書の見出しは rawName のまま使う。 */
const normalizeCompletedName = (
    value: string | null,
    rawName: string,
): string | null => {
    if (value === null) {
        return null;
    }
    const trimmed = value.trim().slice(0, receiptCompletedNameMaxLength);
    return trimmed.length === 0 || trimmed === rawName ? null : trimmed;
};

/** カテゴリ名から既存カテゴリを引く索引。名前は前後の空白と大文字小文字を無視して比較する。 */
const categoryIdByName = (categories: readonly CategoryDto[]) => {
    const index = new Map<string, string>();
    for (const category of categories) {
        const key = category.name.trim().toLocaleLowerCase("ja");
        // 同名が複数階層にある場合は先に見つかった方を使い、解決できたことにしない
        if (!index.has(key)) {
            index.set(key, category.id);
        }
    }
    return index;
};

const toLineWrites = (
    lines: readonly {
        name: string;
        completedName: string | null;
        quantity: number;
        price: number | null;
        taxRate: 8 | 10 | null;
        stockRelevant: boolean;
        expiry: {
            printedDate: string | null;
            estimatedDate: string | null;
            source: "printed" | "estimated" | "unknown";
            confidence: "high" | "medium" | "low" | null;
            estimateReason: string | null;
        };
        stocking: {
            categoryName: string | null;
            baseUnit: string | null;
            baseDimension: ReceiptBaseDimension | null;
        };
    }[],
    categoryIndex: ReadonlyMap<string, string>,
    pricesIncludeTax: boolean,
): ReceiptLineWrite[] => {
    const writes: ReceiptLineWrite[] = [];
    for (const line of lines) {
        const rawName = line.name.trim();
        // 空表記の行は照合も表示もできないため保存しない
        if (rawName.length === 0) {
            continue;
        }
        // 由来と値が食い違う組み合わせをそのまま保存すると、確認画面が
        // 「レシートの印字」と書いた捏造値を提示してしまう
        // 保存列は平たいため、束ねた OCR の期限をここで列の名前へ戻す
        const expiry = normalizeReceiptLineExpiry({
            printedExpiryDate: line.expiry.printedDate,
            estimatedExpiryDate: line.expiry.estimatedDate,
            expirySource: line.expiry.source,
            expiryConfidence: line.expiry.confidence,
            expiryEstimateReason: line.expiry.estimateReason,
        });
        // 単位は表記と量の種類が対でないと品目を作れないため、片方だけの提案は捨てる。
        // 表記は単位表の綴りへ寄せる。提案はそのまま新規品目の基準単位になるため、
        // ここで揃えないと "ml" の品目が作られ続けて価格を換算できなくなる
        const baseUnit = normalizeSuggestedBaseUnit(
            line.stocking.baseUnit?.trim().slice(0, 50) ?? "",
        );
        const unitPaired =
            baseUnit.length > 0 && line.stocking.baseDimension !== null;
        const suggestedCategoryName =
            line.stocking.categoryName?.trim().toLocaleLowerCase("ja") ?? "";
        writes.push({
            lineNo: writes.length + 1,
            rawName,
            completedName: normalizeCompletedName(line.completedName, rawName),
            stockRelevant: line.stockRelevant,
            // 解決できた ID だけを保存する。名前が一致しなければ確認画面で選ばせる
            suggestedCategoryId:
                categoryIndex.get(suggestedCategoryName) ?? null,
            suggestedCategoryName: line.stocking.categoryName?.trim() || null,
            suggestedBaseUnit: unitPaired ? baseUnit : null,
            suggestedBaseDimension: unitPaired
                ? line.stocking.baseDimension
                : null,
            normalizedName: normalizeReceiptName(rawName),
            quantity: line.quantity,
            // 保存する金額は常に税込へ揃える
            price: receiptTaxIncludedPrice(
                line.price,
                line.taxRate,
                pricesIncludeTax,
            ),
            printedExpiryDate: expiry.printedExpiryDate,
            estimatedExpiryDate: expiry.estimatedExpiryDate,
            expirySource: expiry.expirySource,
            expiryConfidence: expiry.expiryConfidence,
            expiryReason: expiry.expiryEstimateReason,
        });
    }
    return writes;
};

/**
 * R2 の画像を OpenRouter のマルチモーダル LLM へ渡し、明細を抽出して保存する。
 * 副作用: 外部 API 呼び出し、`receipt_lines` の全置換、照合結果の更新。
 * 失敗は例外ではなく `status = 'failed'` と利用者向けの `errorMessage` に落とす。
 * `fetcher` は検証用のスタブを差し込むためだけの引数で、既定は実 fetch である。
 */
export interface ReceiptParseToolSet {
    tools: ToolSet;
    close: () => Promise<void>;
}

/**
 * tool を渡す設定が有効なときだけ呼ばれる。transport の構築は API 層が持ち、
 * service は domain と repository の外へ依存しない。
 */
export type ReceiptParseToolSetFactory = () => Promise<ReceiptParseToolSet>;

export interface ReceiptParseOptions {
    fetcher?: typeof fetch;
    createToolSet?: ReceiptParseToolSetFactory;
}

/**
 * tool 呼び出しを許す往復回数。実質の上限は `receiptParseTimeoutMs` の側にあり、
 * この値は往復が終わらない場合の歯止めである。少なすぎると明細を返す前に
 * 打ち切られるため、行数ぶんの品目照合が収まる余裕を持たせる。
 */
const receiptParseMaxSteps = 20;

export const parseReceipt = async (
    env: ReceiptEnv,
    receiptId: string,
    options: ReceiptParseOptions = {},
): Promise<ReceiptDetailDto> => {
    const fetcher = options.fetcher ?? fetch;
    const receipt = await requireReceipt(env.DB, receiptId);
    if (receipt.status === "applied" || receipt.purchaseId !== null) {
        // 反映が始まった後に明細を作り直すと、行 ID が変わって在庫の
        // 行単位冪等性が失われ、適用済みの行がもう一度加算される
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_STATE",
            "反映を開始したレシートは再解析できません。取込履歴で反映結果を確認してください。",
        );
    }
    // 反映処理と同時に走らないよう、状態遷移を条件付き UPDATE で確保する
    if (
        !(await updateReceiptStatus(env.DB, receipt.id, {
            status: "parsing",
            errorMessage: null,
        }))
    ) {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_STATE",
            "このレシートは別の操作の途中です。画面を再読み込みしてから実行してください。",
        );
    }
    try {
        const status = await getOpenRouterIntegrationStatus(env.DB);
        let apiKey: string;
        try {
            apiKey = await getOpenRouterApiKey(
                env.DB,
                env.SETTINGS_ENCRYPTION_KEY,
            );
        } catch {
            throw new ReceiptParseFailure(parseFailureMessages.notConfigured);
        }
        const object = await env.RECEIPTS.get(receipt.objectKey);
        if (!object) {
            throw new ReceiptParseFailure(parseFailureMessages.imageMissing);
        }
        const bytes = new Uint8Array(await object.arrayBuffer());
        const openrouter = createOpenRouter({ apiKey, fetch: fetcher });
        // カテゴリは tool で辿らせず指示へ載せる。`list_categories` は 1 階層ずつ
        // 返すため、木を辿るだけで往復上限を使い切って明細が返らなくなる。
        // 保存時の ID 解決にも同じ一覧を使う
        const categories = await listCategoryTree(env.DB);
        const instructions = receiptParseInstructionsWithCategories(
            status.receiptPrompt,
            categories.items.map((category) => category.name),
        );
        // tool は常に渡す。構築できない環境では tool 無しで解析を続ける
        const toolSet = options.createToolSet
            ? await options.createToolSet()
            : null;
        try {
            // リトライは 1 回まで（既定の 2 回は使わない）。タイムアウトは
            // リトライと tool 呼び出しを含む呼び出し全体へ掛ける
            const result = await generateText({
                // reasoning は設定しない。思考を無効化する指定
                // (`reasoning: { effort: "none" }`) は、思考が必須のモデルでは
                // プロバイダが 400 (Reasoning is mandatory for this endpoint and
                // cannot be disabled) を返して解析全体が失敗する
                model: openrouter.chat(status.chatModel),
                output: Output.object({ schema: receiptOcrResultSchema }),
                instructions,
                ...(toolSet
                    ? {
                          tools: toolSet.tools,
                          stopWhen: stepCountIs(receiptParseMaxSteps),
                          // 上限で打ち切られた step は明細を返せないため、最後の
                          // 1 回は tool を封じて必ず出力させる
                          prepareStep: ({ stepNumber }) =>
                              stepNumber >= receiptParseMaxSteps - 1
                                  ? { toolChoice: "none" }
                                  : {},
                      }
                    : {}),
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "このレシート画像から購入した商品の明細を抽出してください。",
                            },
                            // 画像は file パートで渡す（image パートは AI SDK v7 で非推奨）
                            {
                                type: "file",
                                data: bytes,
                                mediaType: receipt.contentType,
                            },
                        ],
                    },
                ],
                maxRetries: 1,
                abortSignal: AbortSignal.timeout(receiptParseTimeoutMs),
            });
            // 出力が得られない失敗（tool 往復が step 上限で打ち切られた等）と、
            // 出力はあるが schema に合わない失敗をログで切り分ける。
            // 明細の内容は出さず、終了理由と件数だけ残す。
            console.info("receipt parse finished", {
                receiptId: receipt.id,
                finishReason: result.finishReason,
                stepCount: result.steps.length,
                toolCallCount: result.steps.reduce(
                    (total, step) => total + step.toolCalls.length,
                    0,
                ),
                hasOutput: result.output !== undefined,
            });
            const parsed = receiptOcrResultSchema.safeParse(result.output);
            if (!parsed.success) {
                throw new ReceiptParseFailure(parseFailureMessages.malformed);
            }
            const lines = toLineWrites(
                parsed.data.lines,
                categoryIdByName(categories.items),
                parsed.data.pricesIncludeTax,
            );
            if (lines.length === 0) {
                throw new ReceiptParseFailure(parseFailureMessages.malformed);
            }
            await saveReceiptParseResult(env.DB, receipt.id, {
                storeName: parsed.data.storeName,
                purchasedAt: receiptLocalDateTimeToUtc(parsed.data.purchasedAt),
                totalPrice: parsed.data.totalPrice,
                model: status.chatModel,
                lines,
            });
            return await matchReceiptLines(env.DB, receipt.id);
        } finally {
            // 中断・タイムアウトでも transport を残さない
            await toolSet?.close();
        }
    } catch (error) {
        logParseFailure(receipt.id, error);
        await updateReceiptStatus(env.DB, receipt.id, {
            status: "failed",
            errorMessage: toParseFailureMessage(error),
        });
        return await getReceipt(env.DB, receipt.id);
    }
};

/**
 * 補完名の照合キー。内容量やメーカー名を落とした名前で引けるようにする。
 * 補完名が無い行や印字と同じ行は空文字を返し、照合をレシート表記だけに委ねる。
 */
const completedMatchKey = (line: {
    completedName: string | null;
    normalizedName: string;
}): string => {
    if (line.completedName === null) {
        return "";
    }
    const normalized = normalizeReceiptName(line.completedName);
    return normalized === line.normalizedName ? "" : normalized;
};

/**
 * レシート表記で決まらなかった行を補完名でも照合する。「商品 1kg」と
 * 「商品 500g」のように表記が内容量で変わる行を、同じ品目へ寄せるための経路。
 * 補完名は AI の推測を含むが、反映先は確認画面での承認を経るため、
 * 誤った補完でも利用者が反映前に選び直せる。
 */
const matchLineWithCompletedName = (
    line: { completedName: string | null; normalizedName: string },
    source: ReceiptMatchSource,
) => {
    const primary = matchLine(line.normalizedName, source);
    if (primary.itemId !== null) {
        return primary;
    }
    const completed = completedMatchKey(line);
    if (completed.length === 0) {
        return primary;
    }
    const fallback = matchLine(completed, source);
    // 候補しか出なかった場合は、印字そのままの候補を優先して残す
    return fallback.itemId !== null || primary.candidates.length === 0
        ? fallback
        : primary;
};

/**
 * 明細の照合結果を更新する。品目一覧とエイリアス辞書はそれぞれ 1 クエリで読み、
 * 更新も 1 batch にまとめる。類似度だけで確定させないため、候補は保存しない。
 * 利用者が確定させた行（`match_method = 'manual'`）は上書きしない。
 */
export const matchReceiptLines = async (
    db: D1Database,
    receiptId: string,
): Promise<ReceiptDetailDto> => {
    await requireReceipt(db, receiptId);
    const lines = await listReceiptLines(db, receiptId);
    const targets = lines.filter((line) => line.matchMethod !== "manual");
    if (targets.length > 0) {
        const [items, aliases] = await Promise.all([
            listMatchableItems(db, receiptMatchItemLimit),
            listItemAliasesByNormalizedNames(db, [
                ...new Set(
                    targets
                        .flatMap((line) => [
                            line.normalizedName,
                            completedMatchKey(line),
                        ])
                        .filter((key) => key.length > 0),
                ),
            ]),
        ]);
        const index = buildReceiptMatchIndex(items);
        await updateReceiptLineMatches(
            db,
            targets.map((line) => {
                const match = matchLineWithCompletedName(line, {
                    exact: index.exact,
                    aliases,
                    candidates: index.candidates,
                });
                return {
                    id: line.id,
                    matchedItemId: match.itemId,
                    matchMethod: match.method,
                    matchScore: match.score,
                };
            }),
        );
    }
    return await getReceipt(db, receiptId);
};

const mapApplyError = (error: unknown): never => {
    if (
        error instanceof StockServiceError ||
        error instanceof ItemServiceError
    ) {
        if (error.status === 404) {
            throw new ReceiptServiceError(
                "RECEIPT_ITEM_NOT_FOUND",
                error.message,
            );
        }
        if (error.status === 409) {
            throw new ReceiptServiceError(
                "RECEIPT_APPLY_CONFLICT",
                error.message,
            );
        }
        throw invalidInput(error.message);
    }
    throw error;
};

// 価格履歴は基準単位あたりで比較するため、内容量を基準単位へ正規化できる行だけ残す。
// 確認画面は内容量を送らないので、指定が無い行は数量ベースの品目なら 1 個 = 内容量 1、
// 質量・容量の品目なら明細の数量（品目の基準単位での合計量）を 1 セットの内容量とみなす。
// 数量をそのまま入れず normalizeContentAmount を通すのは、次元と基準単位が噛み合わない
// 品目（次元が質量なのに単位が「袋」など）で null に落とすためで、
// 「円/100g」と表示されるのに中身は袋数、という行を残さない
const resolvePriceContentAmount = (
    pricing: ItemPricingRow,
    lineInput: ReceiptApplyLineInput,
    quantity: number,
): number | null => {
    // 明示指定は換算できないものを黙って読み替えない（createPriceRecord が 400 で拒むのと同じ）
    if (lineInput.contentAmount !== undefined) {
        return normalizeContentAmount(
            lineInput.contentAmount,
            lineInput.contentUnit ?? pricing.baseUnit,
            pricing.baseUnit,
            pricing.baseDimension,
        );
    }
    return normalizeContentAmount(
        pricing.baseDimension === "count" ? 1 : quantity,
        pricing.baseUnit,
        pricing.baseUnit,
        pricing.baseDimension,
    );
};

/**
 * 価格履歴の内容量とセット数を決める。明細の数量は基準単位での合計量なので、
 * 「1 セットの内容量 × セット数」へ分解し直す（合計量をそのままセット数にすると
 * 単価が内容量の分だけ小さくなる）。割り切れない指定は合計量を 1 セットとして
 * 記録する。総量が変わらないため単価の比較は保てる。
 */
const resolvePriceContent = (
    pricing: ItemPricingRow,
    lineInput: ReceiptApplyLineInput,
    quantity: number,
): { contentAmount: number; setCount: number } | null => {
    const contentAmount = resolvePriceContentAmount(
        pricing,
        lineInput,
        quantity,
    );
    if (contentAmount === null) {
        return null;
    }
    if (quantity % contentAmount === 0) {
        return { contentAmount, setCount: quantity / contentAmount };
    }
    return { contentAmount: quantity, setCount: 1 };
};

// 単位の食い違いを利用者へ伝えるための表示名。UI の選択肢と同じ文言にする
const dimensionLabels: Record<ReceiptBaseDimension, string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

/**
 * 導いた数量が反映で受け付ける上限に収まっているか確かめる。解析が返す数量には
 * 上限が無く（`receiptOcrLineSchema`）、単位換算は桁を 1000 倍まで増やすため、
 * 「1.5kg」を 1500 kg と読んだ行が g の品目で 1,500,000 になる。この値を
 * `applied_quantity` へ書いてしまうと、開き直した確認画面が数量の検証
 * （1 以上 `receiptApplyQuantityMax` 以下）で送信を止め、既に反映を開始した
 * レシートは削除もできず二度と完了できなくなる。実績を残す前に弾いて、
 * 数量の明示指定かスキップで抜けられる状態を保つ。
 */
const withinQuantityMax = (
    line: ReceiptLineRow,
    pricing: ItemPricingRow,
    quantity: number,
): number => {
    if (quantity <= receiptApplyQuantityMax) {
        return quantity;
    }
    throw invalidInput(
        `${line.lineNo} 行目は品目の単位（${pricing.baseUnit}）で数えると ${quantity.toLocaleString("en-US")} になり、一度に反映できる上限（${receiptApplyQuantityMax.toLocaleString("en-US")}）を超えるため反映できません。数量を品目の単位に直して指定するか、この行は取り込まないでください。`,
    );
};

/**
 * 明細の数量を反映先の品目の単位へ揃える。数量は解析時に提案した単位
 * （`suggested_base_unit`）で表されているため、品目が別の単位で在庫を数えて
 * いる場合はそのまま足すと桁が変わる（ml の 1000 を L の品目へ足すなど）。
 * 質量・体積は換算し、個数は「個」「袋」のような表現の変更を数量の変更と
 * みなさず、そのまま反映する。量の種類自体が違う場合は反映を止める。
 * 確認画面で数量を指定した行はその値を品目の単位での入力とみなし、換算しない。
 */
const resolveLineQuantity = (
    line: ReceiptLineRow,
    pricing: ItemPricingRow,
): number => {
    if (
        line.suggestedBaseUnit === null ||
        line.suggestedBaseUnit === pricing.baseUnit ||
        (line.suggestedBaseDimension === pricing.baseDimension &&
            pricing.baseDimension === "count")
    ) {
        return withinQuantityMax(line, pricing, line.quantity);
    }
    // 量の種類が違う行は数量を直しても筋が通らないため、品目の選び直しを促す
    if (
        line.suggestedBaseDimension !== null &&
        line.suggestedBaseDimension !== pricing.baseDimension
    ) {
        throw invalidInput(
            `${line.lineNo} 行目はレシートが${dimensionLabels[line.suggestedBaseDimension]}（${line.suggestedBaseUnit}）、品目が${dimensionLabels[pricing.baseDimension]}（${pricing.baseUnit}）で数えているため反映できません。反映先の品目を選び直すか、数量を品目の単位に直して指定してください。`,
        );
    }
    const converted = normalizeContentAmount(
        line.quantity,
        line.suggestedBaseUnit,
        pricing.baseUnit,
        pricing.baseDimension,
    );
    if (converted === null) {
        throw invalidInput(
            `${line.lineNo} 行目はレシートの単位（${line.suggestedBaseUnit}）と品目の単位（${pricing.baseUnit}）が違い、換算できないため反映できません。数量を品目の単位に直して指定してください。`,
        );
    }
    return withinQuantityMax(line, pricing, converted);
};

/**
 * 反映の同一性の基点になる購入を決める。まだ反映が始まっていなければ
 * 購入を 1 件作ってレシートへ結び付け（反映開始の宣言）、既に始まっていれば
 * 保存済みの購入をそのまま返す。以後の在庫調整の idempotency key と購入日時は
 * この購入から導くため、再送で入力や key が変わっても二重反映にならない。
 */
const resolveReceiptPurchase = async (
    db: D1Database,
    receipt: ReceiptRow,
    parsed: ReceiptApplyInput,
): Promise<PurchaseRow> => {
    const conflict = (): never => {
        throw new ReceiptServiceError(
            "RECEIPT_APPLY_CONFLICT",
            "このレシートは別の操作で反映中です。画面を再読み込みして結果を確認してください。",
        );
    };
    if (receipt.purchaseId !== null) {
        const existing = await findPurchaseById(db, receipt.purchaseId);
        return existing ?? conflict();
    }
    const storeName = parsed.storeName ?? receipt.storeName;
    if (storeName === null || storeName.trim().length === 0) {
        throw invalidInput(
            "店舗名を読み取れませんでした。購入店舗を入力してください。",
        );
    }
    // 他のレシートで使った key を渡されると、その購入へ在庫が付いてしまう
    const reused = await findPurchaseByIdempotencyKey(
        db,
        parsed.idempotencyKey,
    );
    if (reused) {
        // 二重送信で先行したリクエストが同じ key で作った購入なら、それへ収束させる
        const current = await findReceipt(db, receipt.id);
        if (current?.purchaseId === reused.id) {
            return reused;
        }
        throw new ReceiptServiceError(
            "RECEIPT_APPLY_CONFLICT",
            "この操作 ID は別の購入で使用済みです。画面を再読み込みしてから反映してください。",
        );
    }
    await claimReceiptPurchase(db, receipt.id, {
        source: storeName.trim(),
        purchasedAt: new Date(
            parsed.purchasedAt ??
                receipt.purchasedAt ??
                new Date().toISOString(),
        ).toISOString(),
        note: parsed.note ?? null,
        idempotencyKey: parsed.idempotencyKey,
    });
    const claimed = await findReceipt(db, receipt.id);
    if (!claimed || claimed.purchaseId === null) {
        // 解析など別の操作が同時に走って状態が変わった場合。在庫へは触れていない
        return conflict();
    }
    const purchase = await findPurchaseById(db, claimed.purchaseId);
    if (!purchase) {
        return conflict();
    }
    if (await purchaseBelongsToOtherReceipt(db, purchase.id, receipt.id)) {
        return conflict();
    }
    return purchase;
};

/**
 * 承認された行を在庫・価格・辞書へ反映する。
 *
 * 1 つの巨大トランザクションにはしない。D1 の batch は 1 リクエスト内でしか
 * 原子性を持たず、行ごとに在庫調整・価格・辞書と副作用が分かれるため、
 * 全体を 1 つにまとめると途中失敗で全部やり直しになる。代わりに
 * **行単位で冪等**にし（在庫調整の idempotency key を
 * `${反映の idempotencyKey}:${lineId}` にする）、途中で失敗しても
 * 再実行が続きから収束するようにしている。
 *
 * 冪等性の範囲はレシート自身である。最初の反映がレシートへ購入を 1 件結び付け、
 * 以降の試行は保存済みの購入から key と購入日時を読み直す。そのため
 * 利用者が失敗した行を直して送り直しても、画面を再読み込みして別の key を
 * 送っても、既に在庫が動いた行は再計上されない。行の期限や品目を変えられるのは
 * まだ在庫が動いていない行だけで、適用済みの行を別品目へ付け替える再送は
 * 在庫側の同一性判定が拒否する。
 */
export const applyReceipt = async (
    db: D1Database,
    receiptId: string,
    input: unknown,
    // 新規作成した品目と、購入元の店舗の索引更新に使う binding
    searchEnv: ItemSearchEnv & StoreSearchEnv,
): Promise<ReceiptApplyResult> => {
    const validated = receiptApplyInputSchema.safeParse(input);
    if (!validated.success) {
        throw invalidInput(validationMessage(validated.error.issues));
    }
    const parsed: ReceiptApplyInput = validated.data;
    const receipt = await requireReceipt(db, receiptId);
    // 反映が始まっているレシート（purchase_id あり）は、途中で失敗していても
    // 再実行で続きから収束させる
    if (receipt.purchaseId === null && receipt.status !== "parsed") {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_STATE",
            "解析が完了したレシートだけを反映できます。先に解析を実行してください。",
        );
    }
    const lines = await listReceiptLines(db, receiptId);
    if (lines.length === 0) {
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_STATE",
            "明細のないレシートは反映できません。",
        );
    }
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const seen = new Set<string>();
    for (const lineInput of parsed.lines) {
        if (!lineById.has(lineInput.lineId)) {
            throw invalidInput(
                "このレシートに含まれない明細が指定されています。画面を再読み込みしてください。",
            );
        }
        if (seen.has(lineInput.lineId)) {
            throw invalidInput("同じ明細が複数回指定されています。");
        }
        seen.add(lineInput.lineId);
    }
    if (seen.size !== lines.length) {
        throw invalidInput(
            "すべての明細について、追加・新規作成・スキップのいずれかを指定してください。",
        );
    }
    const purchase = await resolveReceiptPurchase(db, receipt, parsed);
    // 価格履歴を店舗マスタへ結び付ける。購入元は購入 1 件につき 1 つなので、
    // 明細ごとではなくここで 1 回だけ解決する。同じ店舗の表記揺れを新規作成
    // させないため、完全一致・正規化一致・支店名を落とした表記・店名の類似検索の
    // 順で既存を探す
    const store = await resolveStoreByName(searchEnv, purchase.source);
    // 反映の同一性はレシート自身が持つ購入で決まる。利用者が画面を触って
    // 別の key を送っても、最初の適用と同じ key・同じ購入日時へ収束させる
    const applyKey = purchase.idempotencyKey ?? `receipt:${receipt.id}`;
    const occurredAt = purchase.purchasedAt;
    const knownItemIds = [
        ...new Set([
            ...parsed.lines
                .map((lineInput) => lineInput.itemId)
                .filter((itemId): itemId is string => itemId !== undefined),
            ...lines
                .map((line) => line.matchedItemId)
                .filter((itemId): itemId is string => itemId !== null),
        ]),
    ];
    const pricingByItemId = await listItemPricingContexts(db, knownItemIds);
    const results: ReceiptApplyLineResult[] = [];
    // ループ中に新規作成した品目 ID。索引更新は品目ごとに直列で OpenRouter を
    // 叩かないよう、ループを抜けた後に indexItems でまとめて 1 回だけ行う
    const createdItemIds: string[] = [];
    // 行ごとの実績にも押す時刻。再送では最初の反映と同じ時刻へ収束させるため
    // 受け取り済みの appliedAt を優先する。行とレシートで別の時刻にならないよう
    // ループより前に 1 回だけ決める
    const appliedAt = receipt.appliedAt ?? new Date().toISOString();
    try {
        for (const lineInput of parsed.lines) {
            const line = lineById.get(lineInput.lineId);
            if (!line) {
                throw invalidInput("明細が見つかりません。");
            }
            if (lineInput.action === "skip") {
                if (
                    line.appliedAction !== null &&
                    line.appliedAction !== "skip"
                ) {
                    // 既に在庫が動いた行は、後から取り込まないへ倒しても取り消せない
                    // （recordReceiptLineApplied の WHERE も実績を守る）。skip 成功として
                    // 返すと完了画面が「取り込みませんでした」と表示し、報告と在庫が
                    // 食い違うため、記録済みの実績をそのまま結果にする
                    results.push({
                        lineId: line.id,
                        action: line.appliedAction,
                        itemId: line.matchedItemId,
                        itemCreated: false,
                        // 実績のある行の applied_quantity は必ず埋まっているが、
                        // 列は null を許すため 0 で受ける（数量なしとして表示される）
                        quantity: line.appliedQuantity ?? 0,
                        expiryDate: receiptExpiryDateToLotExpiry(
                            line.appliedExpiryDate,
                        ),
                        // 在庫を動かしたのは先の反映であることを画面へ伝える
                        replayed: true,
                        priceRecorded: false,
                        aliasRegistered: false,
                    });
                    continue;
                }
                // 取り込まなかったことも記録として残す。数量・金額・期限は
                // 何も動かしていないため持たせない
                await recordReceiptLineApplied(db, line.id, {
                    action: "skip",
                    quantity: null,
                    baseUnit: null,
                    price: null,
                    expiryDate: null,
                    appliedAt,
                });
                results.push({
                    lineId: line.id,
                    action: "skip",
                    itemId: null,
                    itemCreated: false,
                    quantity: 0,
                    expiryDate: null,
                    replayed: false,
                    priceRecorded: false,
                    aliasRegistered: false,
                });
                continue;
            }
            let itemId: string;
            let itemCreated = false;
            let pricing: ItemPricingRow | undefined;
            if (lineInput.action === "add_to_item") {
                if (lineInput.itemId === undefined) {
                    throw invalidInput("反映先の品目を選択してください。");
                }
                itemId = lineInput.itemId;
                pricing = pricingByItemId.get(itemId);
                if (!pricing) {
                    throw new ReceiptServiceError(
                        "RECEIPT_ITEM_NOT_FOUND",
                        "指定した品目が見つかりません。品目を選び直してください。",
                    );
                }
            } else if (
                line.matchedItemId !== null &&
                line.matchMethod === "manual"
            ) {
                // 再実行で品目を作り直さない。反映先は在庫を動かす前に
                // 行へ記録済みで、この列が確定済みの目印になる
                itemId = line.matchedItemId;
                pricing = pricingByItemId.get(itemId);
                if (!pricing) {
                    throw new ReceiptServiceError(
                        "RECEIPT_ITEM_NOT_FOUND",
                        "作成済みの品目が見つかりません。取込をやり直してください。",
                    );
                }
            } else {
                if (lineInput.newItem === undefined) {
                    throw invalidInput(
                        "作成する品目の内容を指定してください。",
                    );
                }
                // 品目 ID を先に行へ予約する。品目作成の直後に失敗しても、
                // 再実行が同じ ID の品目を探して再利用するため、同名の孤児品目が
                // 増えない（matched_item_id は FK があり作成前には書けない）
                const reservedItemId = await reserveReceiptLineItemId(
                    db,
                    line.id,
                    newId(),
                );
                const reserved = (
                    await listItemPricingContexts(db, [reservedItemId])
                ).get(reservedItemId);
                if (reserved) {
                    itemId = reservedItemId;
                    pricing = reserved;
                } else {
                    const created = await createItem(db, lineInput.newItem, {
                        id: reservedItemId,
                    });
                    itemId = created.id;
                    itemCreated = true;
                    pricing = {
                        id: created.id,
                        baseUnit: created.baseUnit,
                        baseDimension: created.baseDimension,
                    };
                    createdItemIds.push(created.id);
                }
                pricingByItemId.set(itemId, pricing);
                await setReceiptLineMatch(db, line.id, {
                    matchedItemId: itemId,
                    matchMethod: "manual",
                    matchScore: null,
                });
            }
            if (
                lineInput.action === "add_to_item" &&
                (line.matchedItemId !== itemId || line.matchMethod !== "manual")
            ) {
                // 反映先は利用者が承認した値である。履歴として行へ残す
                await setReceiptLineMatch(db, line.id, {
                    matchedItemId: itemId,
                    matchMethod: "manual",
                    matchScore: null,
                });
            }
            const quantity =
                lineInput.quantity ?? resolveLineQuantity(line, pricing);
            const expiryDate =
                lineInput.expiryDate !== undefined
                    ? lineInput.expiryDate
                    : resolveLineExpiry(line);
            const lotExpiryDate = receiptExpiryDateToLotExpiry(expiryDate);
            const stock = await adjustStock(db, itemId, {
                delta: quantity,
                reason: "purchase",
                expiryDate: lotExpiryDate,
                occurredAt,
                idempotencyKey: `${applyKey}:${line.id}`,
            });
            const price =
                lineInput.price !== undefined ? lineInput.price : line.price;
            // 実際に在庫が動いたときだけ記録する。再送（replayed）で送られた値は
            // 在庫へ届いていないため、最初の反映が書いた実績を塗り替えない。
            // 期限はロットの ISO 8601 UTC ではなく、確認画面と同じ日付で残す
            if (!stock.replayed) {
                await recordReceiptLineApplied(db, line.id, {
                    action: lineInput.action,
                    quantity,
                    baseUnit: pricing.baseUnit,
                    price,
                    expiryDate,
                    appliedAt,
                });
            }
            let priceRecorded = false;
            // 再送では在庫が動いていないため価格も二重に記録しない。
            // movement 確定後に価格記録だけ落ちた場合は再実行でも補えないが、
            // 二重計上より欠測の方が在庫・支出の整合を壊さない
            if (!stock.replayed && price !== null) {
                const content = resolvePriceContent(
                    pricing,
                    lineInput,
                    quantity,
                );
                if (content !== null) {
                    await insertPriceRecord(db, {
                        itemId,
                        purchaseId: purchase.id,
                        contentAmount: content.contentAmount,
                        setCount: content.setCount,
                        packaging: lineInput.packaging ?? null,
                        price,
                        source: purchase.source,
                        storeId: store.id,
                        url: null,
                        recordedAt: occurredAt,
                    });
                    priceRecorded = true;
                }
            }
            let aliasRegistered = false;
            if (lineInput.registerAlias && line.normalizedName.length > 0) {
                // 既に別品目へ割り当て済みの表記は奪わない（ON CONFLICT DO NOTHING）
                aliasRegistered = await insertItemAliasIfAbsent(db, {
                    itemId,
                    normalizedName: line.normalizedName,
                    displayName: line.rawName,
                    source: "receipt",
                });
            }
            results.push({
                lineId: line.id,
                action: lineInput.action,
                itemId,
                itemCreated,
                quantity,
                expiryDate: lotExpiryDate,
                replayed: stock.replayed,
                priceRecorded,
                aliasRegistered,
            });
        }
    } catch (error) {
        return mapApplyError(error);
    } finally {
        // indexItems 自体が best-effort なので、失敗しても反映は止めない。
        // 途中で失敗しても、それまでに作成した品目は finally で索引する
        await indexItems(searchEnv, createdItemIds);
    }
    if (
        !(await markReceiptApplied(db, receiptId, {
            purchaseId: purchase.id,
            appliedAt,
        }))
    ) {
        throw new ReceiptServiceError(
            "RECEIPT_APPLY_CONFLICT",
            "このレシートは別の操作で反映中です。画面を再読み込みして結果を確認してください。",
        );
    }
    return {
        receipt: await getReceipt(db, receiptId),
        purchaseId: purchase.id,
        appliedAt,
        lines: results,
    };
};

/**
 * レシートと画像を削除する。反映を開始したものは購入履歴の根拠が消えるため拒否する。
 * 行は `receipt_lines` の cascade で消える。R2 の削除に失敗しても
 * D1 の削除は取り消さない（参照されないオブジェクトが残るだけで、業務データは壊れない）。
 */
export const deleteReceipt = async (
    env: ReceiptEnv,
    receiptId: string,
): Promise<void> => {
    const receipt = await requireReceipt(env.DB, receiptId);
    if (receipt.status === "applied" || receipt.purchaseId !== null) {
        // 途中まで反映されたレシートを消すと、増えた在庫・購入・価格履歴だけが
        // 根拠を失って残る。反映が始まった時点で削除できなくする
        throw new ReceiptServiceError(
            "RECEIPT_INVALID_STATE",
            "反映を開始したレシートは削除できません。取込履歴で反映結果を確認してください。",
        );
    }
    if (!(await deleteReceiptRow(env.DB, receiptId))) {
        throw new ReceiptServiceError(
            "RECEIPT_NOT_FOUND",
            "レシートが見つかりません。",
        );
    }
    await env.RECEIPTS.delete(receipt.objectKey).catch(() => undefined);
};

// SQLite は真偽値を 0/1 で返すため、DTO へ渡す前に真偽値へ直す
const toReceiptExampleDto = (row: ReceiptExampleRow): ReceiptExampleDto => ({
    rawName: row.rawName,
    completedName: row.completedName,
    normalizedName: row.normalizedName,
    itemName: row.itemName,
    baseUnit: row.baseUnit,
    baseDimension: row.baseDimension,
    categoryName: row.categoryName,
    storeName: row.storeName,
    suggestedBaseUnit: row.suggestedBaseUnit,
    suggestedBaseDimension: row.suggestedBaseDimension,
    suggestedCategoryName: row.suggestedCategoryName,
    corrected: row.corrected === 1,
    appliedAt: row.appliedAt,
});

/**
 * 反映まで終わったレシート明細を、次回以降の解析が参照できる実例として返す。
 * 表記は行ごとに問い合わせず 1 回でまとめて受け、照合キーは辞書・明細と同じ
 * 正規化を通す。読み取りだけで、在庫も辞書も動かさない。
 */
export const listReceiptExamples = async (
    db: D1Database,
    input: unknown,
): Promise<ReceiptExampleListDto> => {
    const validated = receiptExampleQuerySchema.safeParse(input);
    if (!validated.success) {
        throw invalidInput(validationMessage(validated.error.issues));
    }
    const { names, limit, correctedOnly } = validated.data;
    // 正規化して空になる表記（記号だけの印字など）はどの行とも一致しないため、
    // 問い合わせからは外しつつ notFound には載せる
    const normalizedByQuery = new Map(
        (names ?? []).map((name) => [name, normalizeReceiptName(name)]),
    );
    const normalizedNames =
        names === undefined
            ? null
            : [
                  ...new Set(
                      [...normalizedByQuery.values()].filter(
                          (value) => value.length > 0,
                      ),
                  ),
              ];
    const rows = await listAppliedReceiptLineExamples(db, {
        normalizedNames,
        limit,
        correctedOnly,
    });
    const found = new Set(rows.map((row) => row.normalizedName));
    return {
        examples: rows.map(toReceiptExampleDto),
        notFound:
            names === undefined
                ? []
                : names.filter((name) => {
                      const normalized = normalizedByQuery.get(name);
                      return normalized === undefined || !found.has(normalized);
                  }),
    };
};
