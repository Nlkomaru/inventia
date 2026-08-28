import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createItem, getItem } from "./itemService";
import { createLocation } from "./locationService";
import {
    adjustStock,
    correctStockMovementNote,
    listStockHistory,
} from "./stockService";

// 0001_seed_base_categories.sql が投入する日用品ルート
const dailyGoodsId = "019fdcef-ee13-7178-9c19-2a5bde5c3778";

describe("個別在庫の出庫と移動メモ訂正", () => {
    it("FEFO 出庫を冪等に適用し、movement id で対象メモだけを監査付き訂正する", async () => {
        const suffix = crypto.randomUUID();
        const location = await createLocation(env.DB, {
            name: `stock-service-${suffix}`,
        });
        const item = await createItem(env.DB, {
            name: `test-item-${suffix}`,
            categoryId: dailyGoodsId,
            locationId: location.id,
            baseUnit: "個",
            baseDimension: "count",
            currentQuantity: 10,
            expiryDate: "2026-09-01T00:00:00.000Z",
        });
        await adjustStock(env.DB, item.id, {
            delta: 5,
            reason: "purchase",
            expiryDate: "2026-10-01T00:00:00.000Z",
            note: "補充",
            idempotencyKey: `receive-${suffix}`,
        });

        const issued = await adjustStock(env.DB, item.id, {
            delta: -12,
            reason: "consume",
            note: "朝食",
            idempotencyKey: `issue-${suffix}`,
        });
        expect(issued).toMatchObject({
            currentQuantity: 3,
            replayed: false,
            movement: { reason: "consume", note: "朝食", revisions: [] },
            allocations: [
                {
                    expiryDate: "2026-09-01T00:00:00.000Z",
                    delta: -10,
                },
                {
                    expiryDate: "2026-10-01T00:00:00.000Z",
                    delta: -2,
                },
            ],
        });

        const replayed = await adjustStock(env.DB, item.id, {
            delta: -12,
            reason: "consume",
            note: "朝食",
            idempotencyKey: `issue-${suffix}`,
        });
        expect(replayed.replayed).toBe(true);
        expect(replayed.currentQuantity).toBe(3);

        const targetMovementId = issued.movement?.id;
        if (!targetMovementId) {
            throw new Error("the issue movement was not recorded");
        }
        const beforeCorrection = await getItem(env.DB, item.id);
        const beforeHistory = await listStockHistory(env.DB, {
            itemId: item.id,
        });
        const otherMovement = beforeHistory.movements.find(
            (movement) => movement.id !== targetMovementId,
        );
        if (!otherMovement) {
            throw new Error("a non-target movement was not recorded");
        }

        const corrected = await correctStockMovementNote(
            env.DB,
            targetMovementId,
            { note: "夕食" },
        );
        expect(corrected).toMatchObject({
            id: targetMovementId,
            delta: -12,
            reason: "consume",
            note: "夕食",
            revisions: [
                {
                    beforeNote: "朝食",
                    afterNote: "夕食",
                },
            ],
        });
        expect(corrected.allocations).toEqual(issued.allocations);

        // 同じ訂正の再送では監査を二重に追加しない
        const sameCorrection = await correctStockMovementNote(
            env.DB,
            targetMovementId,
            { note: "夕食" },
        );
        expect(sameCorrection.revisions).toHaveLength(1);

        const afterCorrection = await getItem(env.DB, item.id);
        expect(afterCorrection.currentQuantity).toBe(
            beforeCorrection.currentQuantity,
        );
        expect(afterCorrection.lots).toEqual(beforeCorrection.lots);
        const afterHistory = await listStockHistory(env.DB, {
            itemId: item.id,
        });
        expect(afterHistory.movements).toHaveLength(
            beforeHistory.movements.length,
        );
        expect(
            afterHistory.movements.find(
                (movement) => movement.id === otherMovement.id,
            ),
        ).toEqual(otherMovement);
        expect(
            afterHistory.movements.find(
                (movement) => movement.id === targetMovementId,
            )?.note,
        ).toBe("夕食");
    });

    it("在庫不足と存在しない movement id を明確な業務エラーにする", async () => {
        const suffix = crypto.randomUUID();
        const location = await createLocation(env.DB, {
            name: `stock-errors-${suffix}`,
        });
        const item = await createItem(env.DB, {
            name: `error-item-${suffix}`,
            categoryId: dailyGoodsId,
            locationId: location.id,
            baseUnit: "個",
            baseDimension: "count",
            currentQuantity: 1,
        });

        await expect(
            adjustStock(env.DB, item.id, {
                delta: -2,
                reason: "discard",
                idempotencyKey: `insufficient-${suffix}`,
            }),
        ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", status: 409 });
        await expect(
            correctStockMovementNote(env.DB, `missing-${suffix}`, {
                note: "訂正",
            }),
        ).rejects.toMatchObject({ code: "MOVEMENT_NOT_FOUND", status: 404 });
    });
});
