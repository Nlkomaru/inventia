/**
 * パンくずの 1 段。`to` を持つ段はリンクになり、末尾は常に現在地として描く。
 */
export interface Breadcrumb {
    label: string;
    to?: string;
}

/**
 * ルートが名乗るパンくず。階層は一致した route の並びから自動で決まるため、
 * 各 route は自分の段だけを名乗る。
 *
 * 名前が固定の画面は `staticData.breadcrumbs` に配列を置く。品目名や場所名の
 * ように読み込んでみないと決まらない画面は、loader の戻り値に `breadcrumbs` を
 * 含めると、そちらが同じ段として使われる。祖先を辿る画面は段を複数返してよい。
 */
export interface BreadcrumbsLoaderData {
    breadcrumbs: readonly Breadcrumb[];
}

const isBreadcrumb = (value: unknown): value is Breadcrumb => {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value as { label?: unknown; to?: unknown };
    return (
        typeof candidate.label === "string" &&
        (candidate.to === undefined || typeof candidate.to === "string")
    );
};

/**
 * loader の戻り値からパンくずを取り出す。読み込み中や、パンくずを名乗らない
 * route では null を返し、呼び出し側が `staticData` へ落ちられるようにする。
 *
 * loader の戻り値は route ごとに型が違い、match をまたぐと `unknown` になる。
 * ここで実行時に確かめることで、型を偽らずに 1 か所へ閉じ込める。
 */
export const breadcrumbsFromLoaderData = (
    loaderData: unknown,
): readonly Breadcrumb[] | null => {
    if (typeof loaderData !== "object" || loaderData === null) {
        return null;
    }
    const candidate = (loaderData as { breadcrumbs?: unknown }).breadcrumbs;
    if (!Array.isArray(candidate) || !candidate.every(isBreadcrumb)) {
        return null;
    }
    return candidate;
};
