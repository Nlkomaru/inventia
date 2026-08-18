import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    type ReceiptStatus,
    receiptStatuses,
    receiptStatusSchema,
} from "@/domain/receipt";
import { receiptListQueryOptions } from "./-api/receipt-queries";
import {
    formatDateTimeOrDash,
    formatYen,
    receiptStatusClassNames,
    receiptStatusLabels,
} from "./-functions/receipt-format";

// 絞り込みは URL に持たせる。不正値は既定（絞り込みなし）へ寄せる。
const receiptListSearchSchema = z.object({
    status: receiptStatusSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/_app/_inventory/receipts/")({
    validateSearch: receiptListSearchSchema,
    loaderDeps: ({ search }) => search,
    loader: ({ context, deps }) =>
        context.queryClient.ensureInfiniteQueryData(
            receiptListQueryOptions(deps),
        ),
    staticData: {
        breadcrumbs: [{ label: "レシート取込" }],
    },
    component: ReceiptListPage,
    pendingComponent: ReceiptListPending,
    errorComponent: ReceiptListError,
});

const pageClassName =
    "mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

const allFilterValue = "all";

const isStatus = (value: string): value is ReceiptStatus =>
    receiptStatuses.some((status) => status === value);

function ReceiptListPage() {
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const listQuery = useSuspenseInfiniteQuery(receiptListQueryOptions(search));
    const receipts = useMemo(
        () => listQuery.data.pages.flatMap((page) => page.receipts),
        [listQuery.data],
    );
    const error = listQuery.error
        ? errorMessage(listQuery.error, "取込履歴を読み込めませんでした")
        : null;

    const statusFilter = search.status ?? allFilterValue;
    const statusOptions = [
        { label: "すべての状態", value: allFilterValue },
        ...receiptStatuses.map((status) => ({
            label: receiptStatusLabels[status],
            value: status,
        })),
    ];
    // 絞り込みは戻る操作の対象にしない
    const handleStatusChange = (value: string | null) => {
        void navigate({
            replace: true,
            search: {
                status: value !== null && isStatus(value) ? value : undefined,
            },
        });
    };

    return (
        <main className={pageClassName}>
            <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        Inventory
                    </p>
                    <h1 className="mt-1 text-2xl font-bold">レシート取込</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        取り込んだレシートの履歴です。未反映のレシートは、続きから確認・反映できます。
                    </p>
                </div>
                <Button
                    render={
                        // biome-ignore lint/a11y/useAnchorContent: Base UI forwards Button children to this anchor.
                        <a
                            aria-label="レシートを取り込む"
                            href="/receipts/new"
                        />
                    }
                >
                    レシートを取り込む
                </Button>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>取込履歴</CardTitle>
                    <CardDescription>
                        新しい順に表示します。反映済みのレシートは購入として記録されています。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <Field className="sm:max-w-64">
                        <FieldLabel htmlFor="receipt-status">状態</FieldLabel>
                        <Select
                            items={statusOptions}
                            onValueChange={handleStatusChange}
                            value={statusFilter}
                        >
                            <SelectTrigger
                                className="w-full"
                                id="receipt-status"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {statusOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>

                    {error ? (
                        <div
                            aria-live="assertive"
                            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{error}</span>
                            <Button
                                onClick={() => void listQuery.refetch()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    ) : null}

                    {receipts.length === 0 ? (
                        <p
                            aria-live="polite"
                            className="text-sm text-muted-foreground"
                        >
                            取込履歴がありません。レシート画像をアップロードすると表示されます。
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>取込日時</TableHead>
                                        <TableHead>状態</TableHead>
                                        <TableHead>店舗</TableHead>
                                        <TableHead>購入日時</TableHead>
                                        <TableHead className="text-right">
                                            合計
                                        </TableHead>
                                        <TableHead className="text-right">
                                            明細
                                        </TableHead>
                                        <TableHead className="text-right">
                                            操作
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {receipts.map((receipt) => (
                                        <TableRow key={receipt.id}>
                                            <TableCell className="align-top whitespace-nowrap">
                                                {formatDateTimeOrDash(
                                                    receipt.createdAt,
                                                )}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                <span
                                                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${receiptStatusClassNames[receipt.status]}`}
                                                >
                                                    {
                                                        receiptStatusLabels[
                                                            receipt.status
                                                        ]
                                                    }
                                                </span>
                                                {receipt.status === "failed" &&
                                                receipt.errorMessage !==
                                                    null ? (
                                                    <p className="mt-1 max-w-56 break-words text-xs text-destructive">
                                                        {receipt.errorMessage}
                                                    </p>
                                                ) : null}
                                            </TableCell>
                                            <TableCell className="max-w-48 break-words align-top">
                                                {receipt.storeName ?? "—"}
                                            </TableCell>
                                            <TableCell className="align-top whitespace-nowrap">
                                                {formatDateTimeOrDash(
                                                    receipt.purchasedAt,
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right align-top whitespace-nowrap">
                                                {formatYen(receipt.totalPrice)}
                                            </TableCell>
                                            <TableCell className="text-right align-top">
                                                {receipt.lineCount}
                                            </TableCell>
                                            <TableCell className="text-right align-top">
                                                <Button
                                                    render={
                                                        // biome-ignore lint/a11y/useAnchorContent: Base UI forwards Button children to this anchor.
                                                        <a
                                                            aria-label={`${receipt.storeName ?? "レシート"}の取込を開く`}
                                                            href={resumeHref(
                                                                receipt.id,
                                                            )}
                                                        />
                                                    }
                                                    size="sm"
                                                    variant="outline"
                                                >
                                                    {receipt.status ===
                                                    "applied"
                                                        ? "内容を見る"
                                                        : "続きから確認"}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="justify-between">
                    <p className="text-sm text-muted-foreground">
                        {receipts.length} 件を表示中
                        {listQuery.hasNextPage ? "" : "（すべて表示）"}
                    </p>
                    <Button
                        disabled={
                            !listQuery.hasNextPage ||
                            listQuery.isFetchingNextPage
                        }
                        onClick={() => void listQuery.fetchNextPage()}
                        type="button"
                        variant="outline"
                    >
                        {listQuery.isFetchingNextPage
                            ? "読み込み中…"
                            : "続きを読み込む"}
                    </Button>
                </CardFooter>
            </Card>
        </main>
    );
}

function ReceiptListPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                取込履歴を読み込んでいます…
            </p>
        </main>
    );
}

function ReceiptListError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {errorMessage(error, "取込履歴を読み込めませんでした")}
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

/** 取込途中のレシートは receiptId 付きの URL で確認画面へ戻れる。 */
const resumeHref = (receiptId: string): string =>
    `/receipts/new?receiptId=${encodeURIComponent(receiptId)}`;
