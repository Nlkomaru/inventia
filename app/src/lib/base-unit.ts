import type { ItemBaseDimension } from "@/domain/item";

// 基準単位の表記から数量の種類を推測する。単価計算の単位表（domain/price.ts）は
// 換算できる正規表記だけを持つのに対し、入力欄には ml や グラム のような表記ゆれが
// 来るため、推測用の対応表はここに分けて持つ。

const massUnits = new Set([
    "g",
    "ｇ",
    "gram",
    "grams",
    "グラム",
    "kg",
    "ｋｇ",
    "キロ",
    "キログラム",
    "mg",
    "ミリグラム",
]);

const volumeUnits = new Set([
    "ml",
    "ｍｌ",
    "ミリリットル",
    "cc",
    "シーシー",
    "l",
    "リットル",
    "dl",
    "デシリットル",
]);

/**
 * 基準単位から数量の種類を推測する。重量・体積として読める表記以外は、
 * 袋・箱・パックのような数えられる単位とみなして個数を返す。
 * 未入力のときだけ空文字を返し、利用者に選ばせる。
 */
export const inferBaseDimension = (
    baseUnit: string,
): ItemBaseDimension | "" => {
    const normalized = baseUnit.trim().toLowerCase();
    if (normalized === "") return "";
    if (massUnits.has(normalized)) return "mass";
    if (volumeUnits.has(normalized)) return "volume";
    return "count";
};
