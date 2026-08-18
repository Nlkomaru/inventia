// レシート表記と品目の照合に使う純粋関数。Cloudflare binding / React / Hono / zod の
// いずれにも依存させず、`node --experimental-strip-types` で直接実行して境界値を確認できる
// 状態に保つ。内部 import を増やすと拡張子なし解決で実行できなくなるため追加しない。

export type ReceiptMatchMethod = "exact" | "alias" | "similarity" | "manual";

/** 照合候補になる品目の最小情報。`normalizedName` は正規化済みの表記。 */
export interface ReceiptMatchItem {
    itemId: string;
    name: string;
    normalizedName: string;
}

/** 類似度候補 1 件。`score` は 0-100 の整数。 */
export interface ReceiptMatchCandidate {
    itemId: string;
    name: string;
    score: number;
}

export interface ReceiptMatchSource {
    /** 正規化した品目名 → 品目 id。同名が複数ある場合は確定させない */
    exact: ReadonlyMap<string, readonly string[]>;
    /** item_aliases の正規化表記 → 品目 id。1 表記は 1 品目にしか結び付かない */
    aliases: ReadonlyMap<string, string>;
    /** 類似度計算の母集合 */
    candidates: readonly ReceiptMatchItem[];
}

export interface ReceiptMatchOptions {
    candidateLimit?: number;
    minimumScore?: number;
}

/**
 * 1 行の照合結果。`itemId` が null なら未確定で、`candidates` は確認画面の提示用である。
 * 類似度だけで確定させないため、`method` に `similarity` は入らない。
 */
export interface ReceiptLineMatch {
    itemId: string | null;
    method: "exact" | "alias" | null;
    score: number | null;
    candidates: ReceiptMatchCandidate[];
}

/** 類似度候補の既定件数。確認画面が扱える件数に抑える。 */
export const receiptMatchCandidateLimit = 5;

/** これ未満の類似度は候補として提示しない。 */
export const receiptMatchMinimumScore = 40;

// NFKC 正規化後に落とす文字。空白・記号・句読点・制御文字を除き、
// 表記ゆれ（全角半角、中黒、括弧、空白）を吸収する。長音記号は Lm のため残る
const droppedCharacterPattern = /[\s\p{P}\p{S}\p{C}]/gu;

/**
 * 照合キーへの正規化。NFKC で全角英数・半角カナを畳み、小文字化し、空白と記号を落とす。
 * `ｺｶｺｰﾗ 500ml` と `コカコーラ　500ML` は同じ値になる。
 */
export const normalizeReceiptName = (raw: string): string =>
    raw.normalize("NFKC").toLowerCase().replace(droppedCharacterPattern, "");

// 文字数は code point で数える。サロゲートペアを 2 文字に割ると
// 絵文字混じりの表記で bigram が壊れる
const toBigramCounts = (value: string): Map<string, number> => {
    const characters = [...value];
    const counts = new Map<string, number>();
    for (let index = 0; index + 1 < characters.length; index += 1) {
        const bigram = `${characters[index]}${characters[index + 1]}`;
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
    return counts;
};

const totalCount = (counts: ReadonlyMap<string, number>): number => {
    let total = 0;
    for (const count of counts.values()) {
        total += count;
    }
    return total;
};

/**
 * bigram の Dice 係数を 0-100 の整数で返す。
 * 空文字は常に 0、完全一致は 100、bigram を作れない 1 文字同士は一致時のみ 100 とする。
 */
export const similarityScore = (left: string, right: string): number => {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }
    if (left === right) {
        return 100;
    }
    const leftCounts = toBigramCounts(left);
    const rightCounts = toBigramCounts(right);
    const leftTotal = totalCount(leftCounts);
    const rightTotal = totalCount(rightCounts);
    if (leftTotal === 0 || rightTotal === 0) {
        return 0;
    }
    let shared = 0;
    for (const [bigram, count] of leftCounts) {
        const other = rightCounts.get(bigram);
        if (other !== undefined) {
            shared += Math.min(count, other);
        }
    }
    return Math.round((2 * shared * 100) / (leftTotal + rightTotal));
};

/**
 * 品目一覧から完全一致表と類似度候補を作る。正規化結果が空になる品目は
 * どの表記とも一致させないため除外する。
 */
export const buildReceiptMatchIndex = (
    items: readonly { id: string; name: string }[],
): { exact: Map<string, string[]>; candidates: ReceiptMatchItem[] } => {
    const exact = new Map<string, string[]>();
    const candidates: ReceiptMatchItem[] = [];
    for (const item of items) {
        const normalizedName = normalizeReceiptName(item.name);
        if (normalizedName.length === 0) {
            continue;
        }
        const existing = exact.get(normalizedName);
        if (existing) {
            existing.push(item.id);
        } else {
            exact.set(normalizedName, [item.id]);
        }
        candidates.push({
            itemId: item.id,
            name: item.name,
            normalizedName,
        });
    }
    return { exact, candidates };
};

// 同点候補の並びを入力順に依存させない。スコア降順 → 表示名昇順 → id 昇順で安定させる
const compareCandidates = (
    left: ReceiptMatchCandidate,
    right: ReceiptMatchCandidate,
): number => {
    if (left.score !== right.score) {
        return right.score - left.score;
    }
    if (left.name !== right.name) {
        return left.name < right.name ? -1 : 1;
    }
    return left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0;
};

const collectCandidates = (
    normalized: string,
    candidates: readonly ReceiptMatchItem[],
    limit: number,
    minimumScore: number,
): ReceiptMatchCandidate[] => {
    const scored: ReceiptMatchCandidate[] = [];
    for (const candidate of candidates) {
        const score = similarityScore(normalized, candidate.normalizedName);
        if (score < minimumScore) {
            continue;
        }
        scored.push({
            itemId: candidate.itemId,
            name: candidate.name,
            score,
        });
    }
    return scored.sort(compareCandidates).slice(0, limit);
};

/**
 * 完全一致 → エイリアス辞書 → 類似度候補の順で照合する。
 * 類似度は候補として返すだけで確定させない（確定は確認画面での利用者の承認）。
 * 同じ正規化名の品目が複数ある場合も確定させず、候補として提示する。
 */
export const matchLine = (
    normalized: string,
    source: ReceiptMatchSource,
    options: ReceiptMatchOptions = {},
): ReceiptLineMatch => {
    const limit = options.candidateLimit ?? receiptMatchCandidateLimit;
    const minimumScore = options.minimumScore ?? receiptMatchMinimumScore;
    if (normalized.length === 0) {
        return { itemId: null, method: null, score: null, candidates: [] };
    }
    const exactMatches = source.exact.get(normalized) ?? [];
    const exactItemId = exactMatches.length === 1 ? exactMatches[0] : undefined;
    if (exactItemId !== undefined) {
        return {
            itemId: exactItemId,
            method: "exact",
            score: 100,
            candidates: [],
        };
    }
    const aliasItemId = source.aliases.get(normalized);
    if (aliasItemId !== undefined) {
        return {
            itemId: aliasItemId,
            method: "alias",
            score: 100,
            candidates: [],
        };
    }
    return {
        itemId: null,
        method: null,
        score: null,
        candidates: collectCandidates(
            normalized,
            source.candidates,
            limit,
            minimumScore,
        ),
    };
};

/** 期限の由来。`receipt_lines.expiry_source` と同じ集合を型でも宣言する。 */
export type ReceiptExpiryOrigin = "printed" | "estimated" | "unknown";

/** 期限の確度。`receipt_lines.expiry_confidence` と同じ集合。 */
export type ReceiptExpiryCertainty = "high" | "medium" | "low";

export interface ReceiptLineExpiry {
    printedExpiryDate: string | null;
    estimatedExpiryDate: string | null;
    expirySource: ReceiptExpiryOrigin;
    expiryConfidence: ReceiptExpiryCertainty | null;
    expiryEstimateReason: string | null;
}

/**
 * モデルが返した期限フィールドを、由来と値が食い違わない形へ正規化する。
 * 表示ラベルは由来だけを読むため、由来が主張する日付が無い組み合わせを残すと
 * 「レシートの印字」と書かれた捏造値を利用者へ見せてしまう。
 * 迷う場合は値を落として `unknown` にし、由来を作り出さない。
 */
export const normalizeReceiptLineExpiry = (
    line: ReceiptLineExpiry,
): ReceiptLineExpiry => {
    if (line.expirySource === "printed" && line.printedExpiryDate !== null) {
        return {
            printedExpiryDate: line.printedExpiryDate,
            estimatedExpiryDate: null,
            expirySource: "printed",
            expiryConfidence: null,
            expiryEstimateReason: null,
        };
    }
    if (
        line.expirySource === "estimated" &&
        line.printedExpiryDate === null &&
        line.estimatedExpiryDate !== null
    ) {
        return {
            printedExpiryDate: null,
            estimatedExpiryDate: line.estimatedExpiryDate,
            expirySource: "estimated",
            expiryConfidence: line.expiryConfidence,
            expiryEstimateReason: line.expiryEstimateReason,
        };
    }
    return {
        printedExpiryDate: null,
        estimatedExpiryDate: null,
        expirySource: "unknown",
        expiryConfidence: null,
        expiryEstimateReason: null,
    };
};

/**
 * 期限の初期値。由来が主張する側の値だけを返す。
 * 由来を無視して印字 → 推測の順で拾うと、`unknown` の行に残った日付を
 * 「印字」として提示してしまうため、由来を判定に含める。
 */
export const resolveLineExpiry = (line: {
    printedExpiryDate: string | null;
    estimatedExpiryDate: string | null;
    expirySource: ReceiptExpiryOrigin;
}): string | null => {
    if (line.expirySource === "printed") {
        return line.printedExpiryDate;
    }
    if (line.expirySource === "estimated") {
        return line.estimatedExpiryDate;
    }
    return null;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * この在庫システムの運用地の UTC からの差（Asia/Tokyo = +09:00）。
 * レシートの日付・日時はこの地域の現地表記として解釈する。
 */
export const receiptLocalUtcOffsetMinutes = 9 * 60;

/**
 * レシート由来の日付（YYYY-MM-DD）をロットの期限（ISO 8601 UTC）へ変換する。
 * ロットの同一性は保存された instant の文字列一致で決まるため、入庫画面が
 * `datetime-local` を現地時刻として解釈するのに合わせ、ここでも現地の 0 時とする。
 * UTC 0 時に固定すると同じ暦日でも別ロットになり、期限が重複する。
 * 解釈できない値は null を返し、呼び出し側で「期限なし」として扱わせる。
 */
export const receiptExpiryDateToLotExpiry = (
    date: string | null,
    utcOffsetMinutes = receiptLocalUtcOffsetMinutes,
): string | null => {
    if (date === null || !isoDatePattern.test(date)) {
        return null;
    }
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    // 2026-02-30 のような存在しない日付は Date が繰り上げるため往復で検証する
    if (new Date(parsed).toISOString().slice(0, 10) !== date) {
        return null;
    }
    return new Date(parsed - utcOffsetMinutes * 60_000).toISOString();
};

// 末尾のタイムゾーン指定は任意で受ける。レシートの印字に時差の情報は無く、
// モデルが Z や +09:00 を足して返すことがあるため、付いていても捨てて現地時刻として読む
const localDateTimePattern =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:?\d{2})?$/u;

/**
 * レシート記載の日時を UTC へ変換する。
 * レシートは購入地の現地時刻で印字されるため、この在庫システムの運用地である
 * Asia/Tokyo (+09:00) として解釈する。解釈できない値は null を返す。
 */
export const receiptLocalDateTimeToUtc = (
    value: string | null,
    utcOffsetMinutes = receiptLocalUtcOffsetMinutes,
): string | null => {
    const matched = value === null ? null : localDateTimePattern.exec(value);
    if (matched === null) {
        return null;
    }
    value = matched[1] ?? null;
    if (value === null) {
        return null;
    }
    const parsed = Date.parse(`${value}Z`);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return new Date(parsed - utcOffsetMinutes * 60_000).toISOString();
};
