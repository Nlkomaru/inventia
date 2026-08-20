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
import type { LocationDto } from "@/domain/location";
import type { BreadcrumbsLoaderData } from "@/lib/breadcrumbs";
import {
    locationItemsQueryOptions,
    locationTreeQueryOptions,
} from "./-api/location-queries";
import {
    buildLocationAncestry,
    buildLocationDetailPath,
    listLocationChildren,
    locationDetailBasePath,
    parseLocationPathIds,
} from "./-functions/location-path";

// 幅は他の画面と揃える。ここだけ狭いと一覧から入ったときに幅が変わって見える
const pageClassName =
    "mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

/** 場所が見つからないことを errorComponent へ伝えるための型。 */
class LocationNotFoundError extends Error {
    constructor(id: string) {
        super(`保管場所が見つかりません（${id}）`);
        this.name = "LocationNotFoundError";
    }
}

export const Route = createFileRoute("/_app/_master/locations/$")({
    // 祖先の並びは URL 自身が持つ情報なので、木を読んでから正しい URL へ
    // 揃える。別の親を書いた URL や id だけの URL でも同じ画面へ収束させる
    loader: async ({ context, params }) => {
        const ids = parseLocationPathIds(params._splat);
        const targetId = ids.at(-1);
        if (targetId === undefined) {
            throw redirect({ to: locationDetailBasePath });
        }
        const tree = await context.queryClient.ensureQueryData(
            locationTreeQueryOptions(),
        );
        const ancestry = buildLocationAncestry(tree.locations, targetId);
        if (ancestry.length === 0) {
            throw new LocationNotFoundError(targetId);
        }
        const canonical = buildLocationDetailPath(tree.locations, targetId);
        if (canonical !== `${locationDetailBasePath}/${ids.join("/")}`) {
            throw redirect({ href: canonical, replace: true });
        }
        await context.queryClient.ensureQueryData(
            locationItemsQueryOptions(targetId),
        );
        // 祖先はそのまま段になる。階層が深くなっても route を増やさずに済む
        return {
            breadcrumbs: ancestry.map((location) => ({
                label: location.name,
                to: buildLocationDetailPath(tree.locations, location.id),
            })),
        } satisfies BreadcrumbsLoaderData;
    },
    component: LocationDetailPage,
    pendingComponent: LocationDetailPending,
    errorComponent: LocationDetailError,
});

function LocationDetailPage() {
    const params = Route.useParams();
    const { data: tree } = useSuspenseQuery(locationTreeQueryOptions());
    const targetId = parseLocationPathIds(params._splat).at(-1) ?? "";
    const ancestry = useMemo(
        () => buildLocationAncestry(tree.locations, targetId),
        [tree.locations, targetId],
    );
    const location = ancestry.at(-1);
    const parents = ancestry.slice(0, -1);
    const children = useMemo(
        () => listLocationChildren(tree.locations, targetId),
        [tree.locations, targetId],
    );
    const { data: items } = useSuspenseQuery(
        locationItemsQueryOptions(targetId),
    );

    if (!location) {
        // loader が先に弾くため通常は起きない。型を絞るための分岐
        return <LocationDetailPending />;
    }

    return (
        <main className={pageClassName}>
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Location
                </p>
                <h1 className="mt-1 text-2xl font-bold break-words">
                    {location.name}
                </h1>
                <nav aria-label="上位の保管場所" className="mt-2 text-sm">
                    {parents.length === 0 ? (
                        <span className="text-muted-foreground">
                            最上位の保管場所です。
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
                                            _splat: locationSplat(
                                                tree.locations,
                                                parent.id,
                                            ),
                                        }}
                                        to="/locations/$"
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
                    <CardTitle>下位の保管場所</CardTitle>
                    <CardDescription>
                        この場所のすぐ下にある保管場所です。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {children.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            下位の保管場所はありません。
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {children.map((child) => (
                                <li key={child.id}>
                                    <Link
                                        className="text-sm underline underline-offset-4"
                                        params={{
                                            _splat: locationSplat(
                                                tree.locations,
                                                child.id,
                                            ),
                                        }}
                                        to="/locations/$"
                                    >
                                        {child.name}
                                    </Link>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {formatItemCount(
                                            tree.itemCounts[child.id] ?? 0,
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>保管されている品目</CardTitle>
                    <CardDescription>
                        この場所に直接置かれている品目です。下位の保管場所の分は含みません。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {items.length === 0 ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            この場所に置かれている品目はありません。
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
                                                to="/inventory/items/$itemId"
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
                                            {item.earliestExpiryDate ??
                                                "期限なし"}
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

/** `/locations/$` の余りに渡す、祖先を含む id の並び。 */
const locationSplat = (
    locations: readonly LocationDto[],
    locationId: string,
): string =>
    buildLocationDetailPath(locations, locationId).slice(
        `${locationDetailBasePath}/`.length,
    );

const formatItemCount = (count: number): string =>
    count === 0 ? "品目なし" : `品目 ${count.toLocaleString("ja-JP")} 件`;

function LocationDetailPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                保管場所を読み込んでいます…
            </p>
        </main>
    );
}

function LocationDetailError({ error, reset }: ErrorComponentProps) {
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
                        : "保管場所を読み込めませんでした"}
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
                        render={<Link to="/locations" />}
                        size="sm"
                        variant="outline"
                    >
                        保管場所の一覧へ戻る
                    </Button>
                </div>
            </div>
        </main>
    );
}
