import type { Meta, StoryObj } from "@storybook/react-vite";
import { InventoryTable } from "@/components/InventoryTable";
import type { ItemDto } from "@/domain/item";
import type { ItemLotDto } from "@/domain/lot";

const dayInMs = 86_400_000;
// 期限の状態は現在時刻を基準に判定されるため、ストーリーの日付も相対で作る
const isoInDays = (days: number): string =>
    new Date(Date.now() + days * dayInMs).toISOString();

const timestamps = {
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
};

const buildItem = (
    overrides: Partial<ItemDto> & Pick<ItemDto, "id" | "name">,
): ItemDto => ({
    categoryId: "cat-food",
    locationId: "loc-pantry",
    baseUnit: "g",
    baseDimension: "mass",
    currentQuantity: 0,
    earliestExpiryDate: null,
    lotCount: 0,
    lowStockThreshold: null,
    memo: null,
    // 読書状態を持つのは書籍カテゴリの品目だけなので、既定は未設定
    readingStatus: null,
    ...timestamps,
    ...overrides,
});

const buildLot = (
    id: string,
    itemId: string,
    quantity: number,
    expiryDate: string | null,
): ItemLotDto => ({
    id,
    itemId,
    quantity,
    expiryDate,
    ...timestamps,
});

const categoryLabels = new Map([
    ["cat-food", "食品"],
    ["cat-supply", "日用品"],
    ["cat-book", "書籍"],
]);

const locationLabels = new Map([
    ["loc-pantry", "食品棚"],
    ["loc-fridge", "冷蔵庫"],
    ["loc-storage", "納戸"],
    ["loc-shelf", "本棚"],
]);

// 書籍は期限を持たず、読書状態だけで区別が付く行になる
const buildBook = (
    overrides: Partial<ItemDto> & Pick<ItemDto, "id" | "name">,
): ItemDto =>
    buildItem({
        categoryId: "cat-book",
        locationId: "loc-shelf",
        baseUnit: "冊",
        baseDimension: "count",
        currentQuantity: 1,
        lotCount: 1,
        ...overrides,
    });

const flour = buildItem({
    id: "it-flour",
    name: "小麦",
    currentQuantity: 1200,
    earliestExpiryDate: isoInDays(45),
    lotCount: 2,
});

const milk = buildItem({
    id: "it-milk",
    name: "牛乳",
    baseUnit: "mL",
    baseDimension: "volume",
    locationId: "loc-fridge",
    currentQuantity: 900,
    earliestExpiryDate: isoInDays(3),
    lotCount: 2,
    lowStockThreshold: 1000,
});

const yogurt = buildItem({
    id: "it-yogurt",
    name: "ヨーグルト",
    baseUnit: "個",
    baseDimension: "count",
    locationId: "loc-fridge",
    currentQuantity: 6,
    earliestExpiryDate: isoInDays(-2),
    lotCount: 2,
});

const tape = buildItem({
    id: "it-tape",
    name: "養生テープ",
    baseUnit: "個",
    baseDimension: "count",
    categoryId: "cat-supply",
    locationId: "loc-storage",
    currentQuantity: 24,
    lotCount: 1,
});

const rice = buildItem({
    id: "it-rice",
    name: "無洗米",
    currentQuantity: 15_000,
    earliestExpiryDate: isoInDays(400),
    lotCount: 1,
});

const battery = buildItem({
    id: "it-battery",
    name: "単三電池",
    baseUnit: "本",
    baseDimension: "count",
    categoryId: "cat-supply",
    locationId: "loc-storage",
    currentQuantity: 0,
    lowStockThreshold: 8,
});

const longName = buildItem({
    id: "it-long-name",
    name: "有機栽培 全粒粉 強力小麦粉（北海道産・チャック付き大容量パック 2.5kg）",
    currentQuantity: 2500,
    earliestExpiryDate: isoInDays(20),
    lotCount: 2,
});

const items = [flour, milk, yogurt, tape, rice, battery, longName];

const lotsByItemId = new Map<string, ItemLotDto[]>([
    [
        flour.id,
        [
            buildLot("lot-flour-1", flour.id, 1000, isoInDays(45)),
            buildLot("lot-flour-2", flour.id, 200, isoInDays(210)),
        ],
    ],
    [
        milk.id,
        [
            buildLot("lot-milk-1", milk.id, 400, isoInDays(3)),
            buildLot("lot-milk-2", milk.id, 500, isoInDays(9)),
        ],
    ],
    [
        yogurt.id,
        [
            buildLot("lot-yogurt-1", yogurt.id, 2, isoInDays(-2)),
            buildLot("lot-yogurt-2", yogurt.id, 4, isoInDays(5)),
        ],
    ],
    [
        longName.id,
        [
            buildLot("lot-long-1", longName.id, 1500, isoInDays(20)),
            buildLot("lot-long-2", longName.id, 1000, null),
        ],
    ],
]);

const meta = {
    title: "Inventory/InventoryTable",
    component: InventoryTable,
    parameters: {
        layout: "padded",
    },
    args: {
        items,
        lotsByItemId,
        categoryLabels,
        locationLabels,
        loading: false,
    },
} satisfies Meta<typeof InventoryTable>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 期限あり・期限なし・複数ロットが混在する通常の一覧。 */
export const Default: Story = {};

export const Empty: Story = {
    args: {
        items: [],
        lotsByItemId: new Map(),
    },
};

export const Loading: Story = {
    args: {
        items: [],
        lotsByItemId: new Map(),
        loading: true,
    },
};

/** 3 件を超えるロットは先頭 2 件と残り件数で表示する。 */
export const MultipleLots: Story = {
    args: {
        items: [
            buildItem({
                id: "it-multi",
                name: "小麦",
                currentQuantity: 1900,
                earliestExpiryDate: isoInDays(10),
                lotCount: 4,
            }),
        ],
        lotsByItemId: new Map([
            [
                "it-multi",
                [
                    buildLot("lot-multi-1", "it-multi", 1000, isoInDays(10)),
                    buildLot("lot-multi-2", "it-multi", 500, isoInDays(60)),
                    buildLot("lot-multi-3", "it-multi", 300, isoInDays(120)),
                    buildLot("lot-multi-4", "it-multi", 100, null),
                ],
            ],
        ]),
    },
};

export const Expired: Story = {
    args: {
        items: [yogurt],
        lotsByItemId: new Map([
            [yogurt.id, lotsByItemId.get(yogurt.id) ?? []],
        ]),
    },
};

export const ExpiringSoon: Story = {
    args: {
        items: [milk],
        lotsByItemId: new Map([[milk.id, lotsByItemId.get(milk.id) ?? []]]),
    },
};

/** ロットが 1 件で期限なしの品目は、バッジも内訳も出さず静かに表示する。 */
export const NoExpiry: Story = {
    args: {
        items: [tape],
        lotsByItemId: new Map(),
    },
};

export const ZeroQuantity: Story = {
    args: {
        items: [battery],
        lotsByItemId: new Map(),
    },
};

export const LongItemName: Story = {
    args: {
        items: [longName],
        lotsByItemId: new Map([
            [longName.id, lotsByItemId.get(longName.id) ?? []],
        ]),
    },
};

export const LargeQuantities: Story = {
    args: {
        items: [
            buildItem({
                id: "it-bulk-rice",
                name: "業務用無洗米",
                currentQuantity: 1_250_000,
                earliestExpiryDate: isoInDays(365),
                lotCount: 3,
            }),
            buildItem({
                id: "it-bulk-water",
                name: "保存水",
                baseUnit: "mL",
                baseDimension: "volume",
                currentQuantity: 480_000,
                earliestExpiryDate: isoInDays(1200),
                lotCount: 1,
            }),
        ],
        lotsByItemId: new Map([
            [
                "it-bulk-rice",
                [
                    buildLot(
                        "lot-bulk-rice-1",
                        "it-bulk-rice",
                        750_000,
                        isoInDays(365),
                    ),
                    buildLot(
                        "lot-bulk-rice-2",
                        "it-bulk-rice",
                        400_000,
                        isoInDays(540),
                    ),
                    buildLot(
                        "lot-bulk-rice-3",
                        "it-bulk-rice",
                        100_000,
                        isoInDays(730),
                    ),
                ],
            ],
        ]),
    },
};

/** ロット内訳をまだ取得できていない状態（件数だけを表示する）。 */
export const LotsUnavailable: Story = {
    args: {
        items: [flour, milk],
        lotsByItemId: new Map(),
    },
};

/**
 * 読書状態の 4 通り。書籍以外（食品）は読書状態を持たず「—」になる。
 */
export const ReadingStatuses: Story = {
    args: {
        items: [
            buildBook({
                id: "it-book-unread",
                name: "積んだままの技術書",
                readingStatus: "unread",
            }),
            buildBook({
                id: "it-book-reading",
                name: "SQL アンチパターン",
                readingStatus: "reading",
            }),
            buildBook({
                id: "it-book-finished",
                name: "リーダブルコード",
                readingStatus: "finished",
            }),
            buildBook({
                id: "it-book-long-name",
                name: "エラー処理と可用性のための分散システム設計 実践ガイド（改訂第 2 版・上巻）",
                currentQuantity: 2,
                readingStatus: "reading",
            }),
            // 書籍以外は読書状態を持たない
            tape,
        ],
        lotsByItemId: new Map(),
    },
};

/**
 * 品目名を詳細ページへのリンクにした表示。アプリ側は TanStack Router の
 * `Link` を渡すが、story はルーターを持たないため素の `<a>` で同じ見た目を示す。
 */
export const LinkedItemNames: Story = {
    args: {
        renderItemName: (item, name) => (
            <a
                className="underline-offset-4 hover:underline"
                href={`/inventory/items/${item.id}`}
            >
                {name}
            </a>
        ),
    },
};
