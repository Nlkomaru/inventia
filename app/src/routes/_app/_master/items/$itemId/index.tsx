import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
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
import type { ItemBaseDimension } from "@/domain/item";
import type { BreadcrumbsLoaderData } from "@/lib/breadcrumbs";
import { buildHierarchyLabels } from "@/lib/hierarchy";
import {
    categoryListQueryOptions,
    itemDetailQueryOptions,
    itemRelabelImpactQueryOptions,
    locationListQueryOptions,
} from "../-api/item-queries";
import { ItemMasterForm } from "../-components/item-master-form";

// 幅は他の画面と揃える。ここだけ狭いと一覧から入ったときに幅が変わって見える
const pageClassName =
    "mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

const dimensionLabels: Record<ItemBaseDimension, string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

export const Route = createFileRoute("/_app/_master/items/$itemId/")({
    // 品目を先に読み、見つからなければ service の 404 をそのまま
    // errorComponent へ渡す。選択肢と警告の材料はその後まとめて読む
    loader: async ({ context, params }) => {
        const item = await context.queryClient.ensureQueryData(
            itemDetailQueryOptions(params.itemId),
        );
        await Promise.all([
            context.queryClient.ensureQueryData(categoryListQueryOptions()),
            context.queryClient.ensureQueryData(locationListQueryOptions()),
            context.queryClient.ensureQueryData(
                itemRelabelImpactQueryOptions(params.itemId),
            ),
        ]);
        // 「品目」の段は親の layout route が名乗る。ここは品目名だけを返す
        return {
            breadcrumbs: [{ label: item.name }],
        } satisfies BreadcrumbsLoaderData;
    },
    component: ItemMasterDetailPage,
    pendingComponent: ItemMasterDetailPending,
    errorComponent: ItemMasterDetailError,
});

function ItemMasterDetailPage() {
    const { itemId } = Route.useParams();
    const { data: item } = useSuspenseQuery(itemDetailQueryOptions(itemId));
    const { data: categories } = useSuspenseQuery(categoryListQueryOptions());
    const { data: locations } = useSuspenseQuery(locationListQueryOptions());
    const { data: impact } = useSuspenseQuery(
        itemRelabelImpactQueryOptions(itemId),
    );
    const categoryLabel = useMemo(
        () => buildHierarchyLabels(categories).get(item.categoryId) ?? "—",
        [categories, item.categoryId],
    );
    const locationLabel = useMemo(
        () => buildHierarchyLabels(locations).get(item.locationId) ?? "—",
        [item.locationId, locations],
    );

    return (
        <main className={pageClassName}>
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Item master
                </p>
                {/* 絵文字は品目の一部なので、名前と同じ見出しの中に置く。
                    絵文字そのものの編集は在庫詳細に置いてあるため重ねない */}
                <h1 className="mt-1 text-2xl font-bold break-words">
                    {item.name}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {categoryLabel} / {locationLabel}
                </p>
                {/* 単位のつけ替えで意味が変わる数量を、編集の前に見せておく */}
                <p className="mt-1 text-sm text-muted-foreground">
                    現在庫 {item.currentQuantity.toLocaleString("ja-JP")}{" "}
                    {item.baseUnit}（{dimensionLabels[item.baseDimension]}）
                    {item.lots.length > 0
                        ? ` / ロット ${item.lots.length.toLocaleString("ja-JP")} 件`
                        : null}
                </p>
                <p className="mt-3">
                    <Link
                        className="text-sm underline underline-offset-4"
                        params={{ itemId: item.id }}
                        to="/inventory/items/$itemId"
                    >
                        在庫・履歴・価格を見る
                    </Link>
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>品目マスタ</CardTitle>
                    <CardDescription>
                        品目そのものの登録内容です。在庫数はここでは変えられません。入出庫や棚卸から更新してください。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {/* 品目を跨いだ遷移では route が再マウントされないため、
                        入力・了解チェックを品目ごとに作り直す */}
                    <ItemMasterForm
                        categories={categories}
                        impact={impact}
                        item={item}
                        key={item.id}
                        locations={locations}
                    />
                </CardContent>
            </Card>
        </main>
    );
}

function ItemMasterDetailPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function ItemMasterDetailError({ error, reset }: ErrorComponentProps) {
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
                        : "品目を読み込めませんでした"}
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
                        render={<Link to="/items" />}
                        size="sm"
                        variant="outline"
                    >
                        品目マスタへ戻る
                    </Button>
                </div>
            </div>
        </main>
    );
}
