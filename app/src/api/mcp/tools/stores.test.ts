import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    type StoreNameMatchCandidate,
    storeDtoSchema,
    storeNameMatchNamesMax,
    storeNameMatchOutputSchema,
} from "../../../domain/store";
import { mergeStoreMatchCandidates } from "../../../services/storeMatchService";
import { createStore } from "../../../services/storeService";
import {
    createTestMcpClient,
    type TestMcpClient,
    toolErrorText,
    toolResult,
} from "../../../test/mcp-client";

// 店舗を作る MCP tool は存在しない（tools/ にあるのはカテゴリ・保管場所・品目・
// 外部提供元だけ）ため、locations.test.ts のように tool で前準備できない。
// 店舗は storeService の createStore を直接呼んで用意し、検証だけを MCP 経由で行う。
// createStore は索引更新まで呼ぶが、storeSearchService 側が best-effort で
// 握りつぶすので VECTORIZE_STORES が無いテスト環境でも成立する。
const seedStore = async (name: string) =>
    storeDtoSchema.parse(await createStore(env, { name }));

describe("resolve_stores", () => {
    let mcp: TestMcpClient;
    // DB はテスト間で共有されるため、店名は毎回変えて衝突を避ける
    let suffix: string;

    beforeEach(async () => {
        mcp = await createTestMcpClient();
        suffix = crypto.randomUUID();
    });

    afterEach(async () => {
        await mcp.close();
    });

    const resolve = async (args: Record<string, unknown>) =>
        storeNameMatchOutputSchema.parse(
            toolResult(await mcp.call("resolve_stores", args)),
        );

    it("登録名そのままの表記は exact で確定し、登録名を返す", async () => {
        const store = await seedStore(`テストストア ${suffix}`);

        const output = await resolve({ names: [store.name] });

        expect(output.results).toHaveLength(1);
        expect(output.results[0]).toMatchObject({
            query: store.name,
            storeId: store.id,
            name: store.name,
            method: "exact",
            candidates: [],
        });
        // 全て確定したので意味検索は不要。実行しなかったことを「使えない」と
        // 混同していないか確かめる
        expect(output.vectorSearchAvailable).toBe(true);
    });

    it("半角カナや空白が崩れた表記も normalized で同じ店舗へ寄せる", async () => {
        const store = await seedStore(`テストストア ${suffix}`);

        const output = await resolve({
            names: [`ﾃｽﾄｽﾄｱ${suffix.toUpperCase()}`],
        });

        const result = output.results[0];
        if (!result) {
            throw new Error("resolve_stores returned no result");
        }
        expect(result).toMatchObject({
            storeId: store.id,
            name: store.name,
            method: "normalized",
            candidates: [],
        });
        // 正規化キーは NFKC・小文字化・記号除去まで掛かる
        expect(result.normalizedQuery).not.toContain(" ");
    });

    it("一致しない表記は確定させず、入力と同じ順で結果を返す", async () => {
        const store = await seedStore(`テストストア ${suffix}`);

        const output = await resolve({
            names: [store.name, `該当なし-${suffix}`],
        });

        expect(output.results.map((result) => result.storeId)).toEqual([
            store.id,
            null,
        ]);
        expect(output.results[1]).toMatchObject({
            name: null,
            method: null,
        });
        // 埋め込みの資格情報がテスト環境に無いため意味検索は実行できない。
        // それでも tool はエラーにならず、名前一致の結果だけを返す
        expect(output.vectorSearchAvailable).toBe(false);
        expect(
            output.results[1]?.candidates.every(
                (candidate) => candidate.source === "similarity",
            ),
        ).toBe(true);
    });

    it("candidateLimit が 0 なら候補を返さず、意味検索も走らせない", async () => {
        await seedStore(`テストストア ${suffix}`);

        const output = await resolve({
            names: [`テストストア ${suffix} 別館`],
            candidateLimit: 0,
        });

        expect(output.results[0]).toMatchObject({
            storeId: null,
            candidates: [],
        });
        expect(output.vectorSearchAvailable).toBe(true);
    });

    it("names の上限を超えた入力は tool の入力スキーマが拒否する", async () => {
        const names = Array.from(
            { length: storeNameMatchNamesMax + 1 },
            (_, index) => `店${index}`,
        );

        // 上限の判定は登録した inputSchema が行うため、service まで届かず
        // STORE_INVALID_INPUT にはならない。toolResult は isError で throw するので
        // エラー検証は生の call を使う
        expect(
            toolErrorText(await mcp.call("resolve_stores", { names })),
        ).toContain("names");
    });
});

// 意味検索はテスト環境に資格情報が無く MCP 経由では通らないため、
// vector 候補の統合だけを純関数として直接確かめる
describe("mergeStoreMatchCandidates", () => {
    const similarity = (storeId: string, score: number) =>
        ({
            storeId,
            name: `類似-${storeId}`,
            source: "similarity",
            score,
        }) satisfies StoreNameMatchCandidate;

    const vector = (storeId: string, score: number) =>
        ({
            storeId,
            name: `意味-${storeId}`,
            source: "vector",
            score,
        }) satisfies StoreNameMatchCandidate;

    it("similarity を先に置き、vector を後ろへ足す", () => {
        const merged = mergeStoreMatchCandidates(
            [similarity("a", 80)],
            [vector("b", 0.9)],
            5,
        );

        expect(merged.map((candidate) => candidate.storeId)).toEqual([
            "a",
            "b",
        ]);
    });

    it("同じ店舗が両方に出たら similarity 側だけを残す", () => {
        const merged = mergeStoreMatchCandidates(
            [similarity("a", 80)],
            [vector("a", 0.99), vector("b", 0.9)],
            5,
        );

        expect(merged).toHaveLength(2);
        expect(merged[0]).toMatchObject({ storeId: "a", source: "similarity" });
        expect(merged[1]).toMatchObject({ storeId: "b", source: "vector" });
    });

    it("vector 候補はスコア降順で並べ、Vectorize の応答順に依存させない", () => {
        const merged = mergeStoreMatchCandidates(
            [],
            [vector("b", 0.5), vector("a", 0.9)],
            5,
        );

        expect(merged.map((candidate) => candidate.storeId)).toEqual([
            "a",
            "b",
        ]);
    });

    it("上限は source ごとに掛かり、類似度が枠を埋めても vector が消えない", () => {
        const merged = mergeStoreMatchCandidates(
            [similarity("a", 90), similarity("b", 80)],
            [vector("c", 0.9), vector("d", 0.8), vector("e", 0.7)],
            2,
        );

        expect(merged.map((candidate) => candidate.storeId)).toEqual([
            "a",
            "b",
            "c",
            "d",
        ]);
    });

    it("candidateLimit が 0 なら両方の候補を落とす", () => {
        expect(
            mergeStoreMatchCandidates(
                [similarity("a", 90)],
                [vector("b", 0.9)],
                0,
            ),
        ).toEqual([]);
    });
});
