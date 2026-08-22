import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    redirect,
    useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { BreadcrumbsLoaderData } from "@/lib/breadcrumbs";
import { formatDisplayDate } from "@/lib/datetime";
import { getEffectiveCategoryKind } from "@/lib/hierarchy";
import {
    categoryItemsQueryOptions,
    categoryTreeQueryOptions,
} from "./-api/category-queries";
import {
    buildCategoryAncestry,
    buildCategoryDetailPath,
    buildCategorySplat,
    categoryDetailBasePath,
    listCategoryChildren,
    parseCategoryPathIds,
} from "./-functions/category-path";

// 幅は他の画面と揃える。ここだけ狭いと一覧から入ったときに幅が変わって見える
const pageClassName = "flex w-full flex-col gap-6 p-4 sm:p-6 lg:p-8";

const kindLabels = {
    daily_goods: "日用品",
    food: "食料品",
    book: "書籍",
    document: "書類",
} as const;

/** カテゴリーが見つからないことを errorComponent へ伝えるための型。 */
class CategoryNotFoundError extends Error {
    constructor(id: string) {
        super(`カテゴリが見つかりません（${id}）`);
        this.name = "CategoryNotFoundError";
    }
}

export const Route = createFileRoute("/_app/_master/categories/$")({
    // 祖先の並びは URL 自身が持つ情報なので、木を読んでから正しい URL へ
    // 揃える。別の親を書いた URL や id だけの URL でも同じ画面へ収束させる
    loader: async ({ context, params }) => {
        const ids = parseCategoryPathIds(params._splat);
        const targetId = ids.at(-1);
        if (targetId === undefined) {
            throw redirect({ to: categoryDetailBasePath });
        }
        const tree = await context.queryClient.ensureQueryData(
            categoryTreeQueryOptions(),
        );
        const ancestry = buildCategoryAncestry(tree.items, targetId);
        if (ancestry.length === 0) {
            throw new CategoryNotFoundError(targetId);
        }
        const canonical = buildCategoryDetailPath(tree.items, targetId);
        if (canonical !== `${categoryDetailBasePath}/${ids.join("/")}`) {
            throw redirect({ href: canonical, replace: true });
        }
        await context.queryClient.ensureQueryData(
            categoryItemsQueryOptions(targetId),
        );
        // 祖先はそのまま段になる。階層が深くなっても route を増やさずに済む
        return {
            breadcrumbs: ancestry.map((category) => ({
                label: category.name,
                to: buildCategoryDetailPath(tree.items, category.id),
            })),
        } satisfies BreadcrumbsLoaderData;
    },
    component: CategoryDetailPage,
    pendingComponent: CategoryDetailPending,
    errorComponent: CategoryDetailError,
});

function CategoryDetailPage() {
    const params = Route.useParams();
    const { data: tree } = useSuspenseQuery(categoryTreeQueryOptions());
    const targetId = parseCategoryPathIds(params._splat).at(-1) ?? "";
    const ancestry = useMemo(
        () => buildCategoryAncestry(tree.items, targetId),
        [tree.items, targetId],
    );
    const category = ancestry.at(-1);
    const parents = ancestry.slice(0, -1);
    const children = useMemo(
        () => listCategoryChildren(tree.items, targetId),
        [tree.items, targetId],
    );
    // 種別は祖先から継ぐため、自身に種別が無くても実効値を出す
    const effectiveKind = useMemo(
        () => getEffectiveCategoryKind(targetId || null, tree.items),
        [tree.items, targetId],
    );
    const { data: items } = useSuspenseQuery(
        categoryItemsQueryOptions(targetId),
    );

    if (!category) {
        // loader が先に弾くため通常は起きない。型を絞るための分岐
        return <CategoryDetailPending />;
    }

    return (
        <main className={pageClassName}>
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Category
                </p>
                <h1 className="mt-1 text-2xl font-bold break-words">
                    {category.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    {effectiveKind === null
                        ? "種別なしの汎用カテゴリです。"
                        : `種別: ${kindLabels[effectiveKind]}${
                              category.kind === null ? "（上位から継承）" : ""
                          }`}
                </p>
                <nav aria-label="上位のカテゴリ" className="mt-2 text-sm">
                    {parents.length === 0 ? (
                        <span className="text-muted-foreground">
                            最上位のカテゴリです。
                        </span>
                    ) : (
                        <ol className="flex flex-wrap items-center gap-1 text-muted-foreground">
                            {parents.map((parent, index) => (
                                <li
                                    className="flex items-center gap-1"
                                    key={parent.id}
                                >
                                    {index > 0 ? <span>/</span> : null}
                                    <Link
                                        className="underline underline-offset-4"
                                        params={{
                                            _splat: buildCategorySplat(
                                                tree.items,
                                                parent.id,
                                            ),
                                        }}
                                        to="/categories/$"
                                    >
                                        {parent.name}
                                    </Link>
                                </li>
                            ))}
                        </ol>
                    )}
                </nav>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>下位のカテゴリ</CardTitle>
                    <CardDescription>
                        このカテゴリのすぐ下にあるカテゴリです。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {children.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            下位のカテゴリはありません。
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {children.map((child) => (
                                <li key={child.id}>
                                    <Link
                                        className="text-sm underline underline-offset-4"
                                        params={{
                                            _splat: buildCategorySplat(
                                                tree.items,
                                                child.id,
                                            ),
                                        }}
                                        to="/categories/$"
                                    >
                                        {child.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>このカテゴリの品目</CardTitle>
                </CardHeader>
                <CardContent>
                    {items.length === 0 ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            このカテゴリの品目はありません。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>品目名</TableHead>
                                    <TableHead className="text-right">
                                        現在庫
                                    </TableHead>
                                    <TableHead>最短期限</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <Link
                                                className="underline underline-offset-4"
                                                params={{ itemId: item.id }}
                                                to="/items/$itemId"
                                            >
                                                {item.name}
                                            </Link>
                                        </TableCell>
                                        <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                                            {item.currentQuantity.toLocaleString(
                                                "ja-JP",
                                            )}{" "}
                                            {item.baseUnit}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                            {formatEarliestExpiry(
                                                item.earliestExpiryDate,
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}

/** 期限は保存値が UTC のため、表示だけ日本時間の日付へ寄せる。 */
const formatEarliestExpiry = (value: string | null): string =>
    value === null ? "期限なし" : (formatDisplayDate(value) ?? value);

function CategoryDetailPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                カテゴリを読み込んでいます…
            </p>
        </main>
    );
}

function CategoryDetailError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {error instanceof Error
                        ? error.message
                        : "カテゴリを読み込めませんでした"}
                </span>
                <div className="flex gap-2">
                    <Button
                        onClick={() => {
                            reset();
                            void router.invalidate();
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                    <Button
                        nativeButton={false}
                        render={<Link to="/categories" />}
                        size="sm"
                        variant="outline"
                    >
                        カテゴリの一覧へ戻る
                    </Button>
                </div>
            </div>
        </main>
    );
}
