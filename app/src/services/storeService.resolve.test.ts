import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
    createStore,
    lookupStoreByName,
    resolveStoreByName,
} from "./storeService";

// 店舗マスタはテストファイル間で共有されるため、屋号は毎回変えて衝突を避ける。
// 支店名の除去は空白より前だけを残すので、屋号の中に空白を入れてはいけない
describe("resolveStoreByName", () => {
    let chain: string;

    beforeEach(() => {
        chain = `イオン-${crypto.randomUUID()}`;
    });

    it("支店名を落としたチェーン名で新しい店舗を作る", async () => {
        const row = await resolveStoreByName(env, `${chain} 幕張店`);

        expect(row.name).toBe(chain);
    });

    it("別の支店のレシートは、先に作られたチェーン名の店舗へ寄せる", async () => {
        const first = await resolveStoreByName(env, `${chain} 幕張店`);

        const second = await resolveStoreByName(env, `${chain} 稲毛店`);

        // 支店ごとに行が増えると、同じチェーンの価格履歴が比較できなくなる
        expect(second.id).toBe(first.id);
        expect(second.name).toBe(chain);
    });

    it("支店名を落とした表記が正規化して一致する店舗にも寄せる", async () => {
        const store = await createStore(env, { name: `${chain}ストア` });

        const row = await resolveStoreByName(env, `${chain}ｽﾄｱ 新宿東口店`);

        expect(row.id).toBe(store.id);
    });

    it("印字そのままで登録済みの店舗は、支店名を落とす前に完全一致で当てる", async () => {
        const branch = await createStore(env, { name: `${chain} 幕張店` });
        const parent = await createStore(env, { name: chain });

        const row = await resolveStoreByName(env, `${chain} 幕張店`);

        // 既存の支店名付きの行を改名も統合もしない。完全一致が最優先
        expect(row.id).toBe(branch.id);
        expect(row.id).not.toBe(parent.id);
    });

    it("屋号そのものが「店」で終わる表記は落とさずにそのまま登録する", async () => {
        const row = await resolveStoreByName(env, `${chain}商店`);

        expect(row.name).toBe(`${chain}商店`);
    });
});

describe("lookupStoreByName", () => {
    let chain: string;

    beforeEach(() => {
        chain = `イオン-${crypto.randomUUID()}`;
    });

    it("印字そのまま、正規化、支店名を落とした表記で登録済みの店舗を返す", async () => {
        const store = await createStore(env, { name: `${chain}ストア` });

        const exact = await lookupStoreByName(env, `${chain}ストア`);
        const normalized = await lookupStoreByName(env, `${chain}ｽﾄｱ`);
        const branch = await lookupStoreByName(env, `${chain}ｽﾄｱ 新宿東口店`);

        expect(exact?.id).toBe(store.id);
        expect(normalized?.id).toBe(store.id);
        expect(branch?.id).toBe(store.id);
    });

    it("登録が無ければ null を返し、店舗を作らない", async () => {
        const missing = await lookupStoreByName(env, `${chain} 幕張店`);
        const still = await lookupStoreByName(env, chain);

        expect(missing).toBeNull();
        expect(still).toBeNull();
    });
});
