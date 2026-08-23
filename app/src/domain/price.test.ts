import { describe, expect, it } from "vitest";
import {
    calculateUnitPrice,
    getPriceUnitDefinition,
    normalizeContentAmount,
    priceUnitDefinitions,
} from "./price";

describe("getPriceUnitDefinition の表記ゆれ", () => {
    // レシート解析の既定プロンプトが長く「ml」を指示していたため、その経路で
    // 作られた品目の基準単位は "ml" で保存されている。単位表は "mL" しか
    // 持たないので、大小文字を区別すると既存データの価格を一切扱えなくなる
    it("mL の別表記はすべて同じ定義へ解決する", () => {
        for (const unit of ["mL", "ml", "ML", "Ml"]) {
            expect(getPriceUnitDefinition(unit)).toEqual(
                priceUnitDefinitions.mL,
            );
        }
    });

    it("L の別表記はすべて同じ定義へ解決する", () => {
        for (const unit of ["L", "l"]) {
            expect(getPriceUnitDefinition(unit)).toEqual(
                priceUnitDefinitions.L,
            );
        }
    });

    it("質量の単位も大小文字を問わない", () => {
        expect(getPriceUnitDefinition("G")).toEqual(priceUnitDefinitions.g);
        expect(getPriceUnitDefinition("KG")).toEqual(priceUnitDefinitions.kg);
    });

    it("単位表に無い表記は解決しない", () => {
        for (const unit of ["袋", "パック", "箱", "", "ミリリットル", "mLL"]) {
            expect(getPriceUnitDefinition(unit)).toBeNull();
        }
    });
});

describe("normalizeContentAmount の表記ゆれ", () => {
    it("基準単位が ml でも mL と同じに換算する", () => {
        expect(normalizeContentAmount(1000, "ml", "ml", "volume")).toBe(1000);
        expect(normalizeContentAmount(1, "L", "ml", "volume")).toBe(1000);
        expect(normalizeContentAmount(1, "l", "mL", "volume")).toBe(1000);
        expect(normalizeContentAmount(1000, "mL", "l", "volume")).toBe(1);
    });

    // 単位表に無い個数の単位（袋、パックなど）でも価格を記録できる恒等変換は
    // 大小文字非依存にしても変わってはいけない
    it("個数は単位表に無い表記でも同じ単位どうしなら通る", () => {
        expect(normalizeContentAmount(3, "袋", "袋", "count")).toBe(3);
        expect(normalizeContentAmount(3, "パック", "パック", "count")).toBe(3);
        expect(normalizeContentAmount(3, "個", "個", "count")).toBe(3);
    });

    it("個数は表記が違えば換算しない", () => {
        expect(normalizeContentAmount(3, "袋", "個", "count")).toBeNull();
        expect(normalizeContentAmount(3, "本", "個", "count")).toBeNull();
    });

    it("次元が食い違う組み合わせは換算しない", () => {
        expect(normalizeContentAmount(1000, "ml", "g", "mass")).toBeNull();
        expect(normalizeContentAmount(3, "袋", "袋", "mass")).toBeNull();
    });
});

describe("calculateUnitPrice の表記ゆれ", () => {
    // 単価は保存せず読み取りのたびに導く。SQL 側の単価式（priceRepository の
    // unitPriceExpression）とここが同じ答えを返さないと、同じ 1 件の記録が
    // 価格履歴と価格比較で 1000 倍ずれる。両側の突き合わせは
    // priceRepository.test.ts が実データで行い、ここは TS 側の規則を固定する
    it("体積の基準単位は大小文字を問わず同じ単価になる", () => {
        // 2 L 入りが 400 円 → 20 円 / 100 mL
        expect(calculateUnitPrice(400, 2, 1, "volume", "L")).toBeCloseTo(
            20,
            10,
        );
        expect(calculateUnitPrice(400, 2, 1, "volume", "l")).toBeCloseTo(
            20,
            10,
        );
        // 2000 mL 入りが 400 円 → 同じ 20 円 / 100 mL
        expect(calculateUnitPrice(400, 2000, 1, "volume", "mL")).toBeCloseTo(
            20,
            10,
        );
        expect(calculateUnitPrice(400, 2000, 1, "volume", "ml")).toBeCloseTo(
            20,
            10,
        );
    });

    it("質量の基準単位は大小文字を問わず同じ単価になる", () => {
        expect(calculateUnitPrice(400, 2, 1, "mass", "kg")).toBeCloseTo(20, 10);
        expect(calculateUnitPrice(400, 2, 1, "mass", "KG")).toBeCloseTo(20, 10);
        expect(calculateUnitPrice(250, 500, 1, "mass", "g")).toBeCloseTo(
            50,
            10,
        );
        expect(calculateUnitPrice(250, 500, 1, "mass", "G")).toBeCloseTo(
            50,
            10,
        );
    });

    it("個数は基準単位の綴りに関係なく 1 個あたりの価格になる", () => {
        expect(calculateUnitPrice(400, 10, 1, "count", "個")).toBeCloseTo(
            40,
            10,
        );
        // 単位表に無い個数単位でも、基準単位がそのまま最小単位として扱われる
        expect(calculateUnitPrice(400, 10, 1, "count", "袋")).toBeCloseTo(
            40,
            10,
        );
        // 個数の品目がたまたま "kg" と名乗っていても 1000 倍の係数は掛からない
        expect(calculateUnitPrice(400, 10, 1, "count", "kg")).toBeCloseTo(
            40,
            10,
        );
    });

    it("質量・体積で単位表に無い基準単位は単価を導けない", () => {
        // 価格記録の作成もつけ替えも同じ換算を通すため、この状態は書き込み側で
        // 作れない。導けないことを黙って 0 などにしない点を固定する
        expect(() => calculateUnitPrice(400, 10, 1, "mass", "袋")).toThrow(
            RangeError,
        );
    });
});
