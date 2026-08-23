import { describe, expect, it } from "vitest";
import type { ReceiptLineDto } from "@/domain/receipt";
import {
    buildApplyLine,
    createReviewRow,
    patchReviewRow,
    type ReceiptReviewRow,
} from "./receipt-review-form";

// 明細 DTO の雛形。検証したい列だけ差分で上書きできるようにする
const createLine = (patch: Partial<ReceiptLineDto> = {}): ReceiptLineDto => ({
    id: "line-1",
    lineNo: 1,
    rawName: "牛乳 1000ml",
    completedName: "牛乳",
    normalizedName: "きゆうにゆう",
    quantity: 1000,
    price: 258,
    stockRelevant: true,
    expiry: {
        printedDate: null,
        estimatedDate: "2026-09-01",
        suggestedDate: "2026-09-01",
        source: "estimated",
        confidence: "medium",
        estimateReason: null,
    },
    suggestion: {
        categoryId: null,
        categoryName: null,
        baseUnit: "mL",
        baseDimension: "volume",
    },
    match: {
        itemId: "item-1",
        itemName: "牛乳",
        method: "exact",
        score: 100,
        candidates: [],
    },
    applied: null,
    ...patch,
});

/** 数量欄へ入力した状態を作る（receipt-review-table.tsx の onChange と同じ patch）。 */
const typeQuantity = (
    row: ReceiptReviewRow,
    value: string,
): ReceiptReviewRow => {
    const patched = patchReviewRow([row], row.lineId, {
        quantity: value,
        quantityEdited: true,
    })[0];
    if (patched === undefined) throw new Error("row was not patched");
    return patched;
};

describe("buildApplyLine の数量", () => {
    it("数量欄を触っていない行は数量を送らない（レシートの単位から品目の単位へ換算させる）", () => {
        const line = createReviewRow(createLine());
        expect(line.quantityEdited).toBe(false);
        expect(buildApplyLine(line)).not.toHaveProperty("quantity");
    });

    it("解析値と同じ数を打ち直した行も数量を明示して送る", () => {
        // サーバーは換算できない単位の組み合わせ（個数の「個」と「本」など）で
        // 「数量を品目の単位に直して指定してください」と返す。その指示どおり
        // 同じ数を入力し直したときに未編集と見なされると、同じエラーが永久に
        // 返り、部分反映のままのレシートを完了できなくなる
        const row = typeQuantity(createReviewRow(createLine()), "1000");
        expect(buildApplyLine(row)).toMatchObject({ quantity: 1000 });
    });

    it("桁を揃えただけの入力も編集として扱う", () => {
        const row = typeQuantity(createReviewRow(createLine()), "01000");
        expect(buildApplyLine(row)).toMatchObject({ quantity: 1000 });
    });

    it("書き換えた数量はそのまま送る", () => {
        const row = typeQuantity(createReviewRow(createLine()), "2");
        expect(buildApplyLine(row)).toMatchObject({ quantity: 2 });
    });

    it("取り込まない行は数量を持たない", () => {
        const row = patchReviewRow([createReviewRow(createLine())], "line-1", {
            action: "skip",
        })[0];
        if (row === undefined) throw new Error("row was not patched");
        expect(buildApplyLine(row)).toEqual({
            lineId: "line-1",
            action: "skip",
            registerAlias: false,
        });
    });
});

describe("createReviewRow の反映済みの行", () => {
    it("記録済みの実績を初期値にし、数量を常に明示して送る", () => {
        // 部分反映のレシートを開き直した状態。在庫調整の冪等性は数量と期限を
        // 含めて判定するため、再送でも 1 回目と同じ値を送る必要がある
        const row = createReviewRow(
            createLine({
                applied: {
                    action: "add_to_item",
                    quantity: 1,
                    baseUnit: "L",
                    price: 250,
                    expiryDate: "2026-09-10",
                    appliedAt: "2026-08-21T00:00:00.000Z",
                },
            }),
        );
        expect(row.quantity).toBe("1");
        expect(row.quantityEdited).toBe(true);
        expect(row.price).toBe("250");
        expect(row.expiryMode).toBe("date");
        expect(row.expiryDate).toBe("2026-09-10");
        expect(buildApplyLine(row)).toMatchObject({
            quantity: 1,
            price: 250,
            expiryDate: "2026-09-10",
        });
    });

    it("金額と期限が記録されていない行は空欄と「期限なし」にする", () => {
        const row = createReviewRow(
            createLine({
                applied: {
                    action: "add_to_item",
                    quantity: 1,
                    baseUnit: "L",
                    price: null,
                    expiryDate: null,
                    appliedAt: "2026-08-21T00:00:00.000Z",
                },
            }),
        );
        expect(row.price).toBe("");
        expect(row.expiryMode).toBe("none");
        expect(buildApplyLine(row)).toMatchObject({
            quantity: 1,
            price: null,
            expiryDate: null,
        });
    });

    it("取り込まなかった記録の行は解析値のまま未編集にする", () => {
        // skip の実績は数量・金額・期限を持たない。解析値を上書きしない
        const row = createReviewRow(
            createLine({
                applied: {
                    action: "skip",
                    quantity: null,
                    baseUnit: null,
                    price: null,
                    expiryDate: null,
                    appliedAt: "2026-08-21T00:00:00.000Z",
                },
            }),
        );
        expect(row.quantity).toBe("1000");
        expect(row.quantityEdited).toBe(false);
        expect(row.price).toBe("258");
        expect(row.expiryDate).toBe("2026-09-01");
    });

    it("取り込まないと決めた行は、照合済みでも取り込まないまま復元する", () => {
        // 照合済み（match.itemId が非 null）の行を利用者が skip にして反映し、
        // 別の行で止まったレシートを開き直す場面。既定へ戻すと検証も警告も
        // 通さずに在庫へ加算され、利用者の判断が無言で消える
        const row = createReviewRow(
            createLine({
                applied: {
                    action: "skip",
                    quantity: null,
                    baseUnit: null,
                    price: null,
                    expiryDate: null,
                    appliedAt: "2026-08-21T00:00:00.000Z",
                },
            }),
        );
        expect(row.action).toBe("skip");
        expect(buildApplyLine(row)).toEqual({
            lineId: "line-1",
            action: "skip",
            registerAlias: false,
        });
    });
});
