import {
    useSuspenseInfiniteQuery,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PriceResearchStatus } from "@/domain/priceResearch";
import {
    categoryTreeQueryOptions,
    itemListQueryOptions,
    locationTreeQueryOptions,
} from "../../_inventory/inventory/receive/-api/stock-queries";
import { storeListQueryOptions } from "../stores/-api/store-queries";
import { priceResearchListQueryOptions } from "./-api/price-research-queries";
import { PriceResearchPage } from "./-components/price-research-page";

export const Route = createFileRoute("/_app/_price/price-research/")({
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureInfiniteQueryData(
                priceResearchListQueryOptions("pending"),
            ),
            context.queryClient.ensureQueryData(storeListQueryOptions()),
            context.queryClient.ensureQueryData(itemListQueryOptions()),
            context.queryClient.ensureQueryData(categoryTreeQueryOptions()),
            context.queryClient.ensureQueryData(locationTreeQueryOptions()),
        ]),
    staticData: {
        breadcrumbs: [{ label: "価格調査依頼" }],
    },
    component: PriceResearchRoutePage,
    pendingComponent: PriceResearchPending,
    errorComponent: PriceResearchError,
});

const pageClassName = "w-full space-y-6 p-4 sm:p-6 lg:p-8";

function PriceResearchRoutePage() {
    const [status, setStatus] = useState<PriceResearchStatus>("pending");
    const researchQuery = useSuspenseInfiniteQuery(
        priceResearchListQueryOptions(status),
    );
    const storesQuery = useSuspenseQuery(storeListQueryOptions());
    const itemsQuery = useSuspenseQuery(itemListQueryOptions());
    const categoriesQuery = useSuspenseQuery(categoryTreeQueryOptions());
    const locationsQuery = useSuspenseQuery(locationTreeQueryOptions());

    const requests = useMemo(
        () => researchQuery.data.pages.flatMap((page) => page.items),
        [researchQuery.data],
    );

    const error = researchQuery.error
        ? errorMessage(
              researchQuery.error,
              "価格調査依頼を読み込めませんでした",
          )
        : null;

    return (
        <PriceResearchPage
            categories={categoriesQuery.data}
            error={error}
            hasNextPage={researchQuery.hasNextPage}
            isFetchingNextPage={researchQuery.isFetchingNextPage}
            items={itemsQuery.data}
            locations={locationsQuery.data}
            onLoadMore={() => void researchQuery.fetchNextPage()}
            onRetry={() => void researchQuery.refetch()}
            onStatusChange={setStatus}
            requests={requests}
            status={status}
            stores={storesQuery.data}
        />
    );
}

function PriceResearchPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                価格調査依頼を読み込んでいます…
            </p>
        </main>
    );
}

function PriceResearchError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {errorMessage(error, "価格調査依頼を読み込めませんでした")}
                </span>
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
