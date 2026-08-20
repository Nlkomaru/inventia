import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { priceRecordListQueryOptions } from "./-api/price-queries";
import { PriceRecordTable } from "./-components/price-record-table";

export const Route = createFileRoute("/_app/_price/prices/")({
    loader: ({ context }) =>
        context.queryClient.ensureInfiniteQueryData(
            priceRecordListQueryOptions(),
        ),
    staticData: {
        breadcrumbs: [{ label: "価格一覧" }],
    },
    component: PricesPage,
    pendingComponent: PricesPending,
    errorComponent: PricesError,
});

const pageClassName = "w-full space-y-6 p-4 sm:p-6 lg:p-8";

function PricesPage() {
    const priceQuery = useSuspenseInfiniteQuery(priceRecordListQueryOptions());
    const records = useMemo(
        () => priceQuery.data.pages.flatMap((page) => page.items),
        [priceQuery.data],
    );
    const error = priceQuery.error
        ? errorMessage(priceQuery.error, "価格を読み込めませんでした")
        : null;

    return (
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">価格一覧</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    すべての品目の価格記録です。単価は内容量で割った比較用の値です。
                </p>
            </header>

            {error ? (
                <div
                    aria-live="assertive"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{error}</span>
                    <Button
                        onClick={() => void priceQuery.refetch()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                </div>
            ) : null}

            <PriceRecordTable
                hasNextPage={priceQuery.hasNextPage}
                isFetchingNextPage={priceQuery.isFetchingNextPage}
                onLoadMore={() => void priceQuery.fetchNextPage()}
                records={records}
            />
        </main>
    );
}

function PricesPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                価格を読み込んでいます…
            </p>
        </main>
    );
}

function PricesError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>{errorMessage(error, "価格を読み込めませんでした")}</span>
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
            </div>
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;
