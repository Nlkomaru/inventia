import type { Breadcrumb } from "./breadcrumbs";

export interface NavItem {
    title: string;
    url: string;
    /** SPA のルートではない画面は、取込作業などを中断させないため別タブで開く */
    opensInNewTab?: boolean;
}

/** サイドバーの区分名。パンくずの先頭の段にも使うため union で固定する。 */
export type NavigationGroupTitle =
    | "在庫管理"
    | "価格"
    | "マスタ"
    | "連携・設定";

export interface NavGroup {
    title: NavigationGroupTitle;
    items: readonly NavItem[];
}

/**
 * サイドバーの区分。パンくずの先頭の段もここから引くことで、区分名と
 * 所属が 2 か所で食い違わないようにする。
 */
export const navigationGroups: readonly NavGroup[] = [
    {
        title: "在庫管理",
        items: [
            { title: "在庫一覧", url: "/inventory/items" },
            { title: "入庫", url: "/inventory/receive" },
            { title: "出庫", url: "/inventory/issue" },
            { title: "棚卸・調整", url: "/inventory/stocktake" },
            { title: "在庫履歴", url: "/inventory/history" },
            { title: "レシート取込", url: "/receipts/new" },
        ],
    },
    {
        title: "価格",
        items: [
            { title: "価格一覧", url: "/prices" },
            { title: "店舗", url: "/stores" },
        ],
    },
    {
        title: "マスタ",
        items: [
            { title: "品目", url: "/items" },
            { title: "カテゴリ", url: "/categories" },
            { title: "保管場所", url: "/locations" },
            { title: "識別子・外部リンク", url: "/references" },
            { title: "外部連携先", url: "/providers" },
        ],
    },
    {
        title: "連携・設定",
        items: [
            { title: "AI・ベクトル検索", url: "/settings/integrations" },
            {
                title: "API リファレンス",
                url: "/api/scalar",
                opensInNewTab: true,
            },
            { title: "MCP エンドポイント", url: "/settings/mcp" },
        ],
    },
];

/** サイドバーの下部に置く外部・補足のリンク。区分には属さない。 */
export const navigationResources: readonly NavItem[] = [
    { title: "OSS ライセンス", url: "/license" },
    { title: "GitHub", url: "https://github.com/Nlkomaru/inventia" },
    { title: "Storybook", url: "/storybook", opensInNewTab: true },
];

/**
 * 区分をパンくずの先頭の段にする。区分そのものに画面は無いため、リンク先は
 * サイドバーで最初に並ぶ画面にする（別タブで開く項目はリンク先にしない）。
 */
export const groupBreadcrumb = (title: NavigationGroupTitle): Breadcrumb => {
    const group = navigationGroups.find((entry) => entry.title === title);
    const landing = group?.items.find((item) => item.opensInNewTab !== true);
    return landing ? { label: title, to: landing.url } : { label: title };
};
