import {
    useMutation,
    useQueryClient,
    useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
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
import { deleteReceipt } from "./-api/receipt-api";
import { receiptKeys, receiptListQueryOptions } from "./-api/receipt-queries";
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

const pageClassName = "mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8";

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
    const queryClient = useQueryClient();
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deleteMutation = useMutation({
        mutationFn: (receiptId: string) => deleteReceipt(receiptId),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: receiptKeys.all }),
    });
    const deleting = deleteMutation.isPending;
    const removeReceipt = async (receiptId: string) => {
        setDeleteError(null);
        try {
            await deleteMutation.mutateAsync(receiptId);
        } catch (cause) {
            setDeleteError(
                errorMessage(cause, "レシートを削除できませんでした"),
            );
        }
    };
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
            <header className="flex items-center justify-between gap-3">
                <h1 className="mt-1 text-2xl font-bold">レシート取込</h1>
                <Button
                    nativeButton={false}
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

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                    <h2 className="font-bold">取込履歴</h2>
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
                </div>

                {error ? (
                    <div className="border-b p-5">
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
                    </div>
                ) : null}

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
                            {receipts.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        aria-live="polite"
                                        className="h-24 text-center text-muted-foreground"
                                        colSpan={7}
                                    >
                                        取込履歴がありません。
                                    </TableCell>
                                </TableRow>
                            ) : null}
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
                                        receipt.errorMessage !== null ? (
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
                                            nativeButton={false}
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
                                            {receipt.status === "applied"
                                                ? "内容を見る"
                                                : "続きから確認"}
                                        </Button>
                                        {/* 反映を開始したレシートは在庫の根拠として残す */}
                                        <Button
                                            aria-label={`${receipt.storeName ?? "レシート"}の取込を削除`}
                                            className="ml-2"
                                            disabled={
                                                deleting ||
                                                receipt.status === "applied" ||
                                                receipt.purchaseId !== null
                                            }
                                            onClick={() =>
                                                void removeReceipt(receipt.id)
                                            }
                                            size="icon-sm"
                                            type="button"
                                            variant="ghost"
                                        >
                                            <Trash2Icon />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex flex-col items-stretch gap-3 border-t p-5">
                    <div aria-live="assertive">
                        {deleteError ? (
                            <p
                                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                                role="alert"
                            >
                                {deleteError}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-3">
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
                    </div>
                </div>
            </section>
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
