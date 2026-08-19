import {
    useMutation,
    useQueryClient,
    useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    useRouter,
} from "@tanstack/react-router";
import {
    CopyIcon,
    EllipsisIcon,
    FileTextIcon,
    PlayIcon,
    Trash2Icon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    type ReceiptDto,
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

/** 操作の読み上げに使う行の呼び名。店舗名を読めなかったレシートも区別できる。 */
const receiptLabel = (receipt: ReceiptDto): string =>
    receipt.storeName ?? "店舗名なしのレシート";

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
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyReceiptId = useCallback(
        (receipt: ReceiptDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("レシートIDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(receipt.id)
                .then(() =>
                    announce(
                        `${receiptLabel(receipt)}のレシートIDをコピーしました`,
                    ),
                )
                .catch(() => announce("レシートIDをコピーできませんでした"));
        },
        [announce],
    );
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

                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="px-5">取込日時</TableHead>
                            <TableHead className="px-5">状態</TableHead>
                            <TableHead className="px-5">店舗</TableHead>
                            <TableHead className="px-5">購入日時</TableHead>
                            <TableHead className="px-5 text-right">
                                合計
                            </TableHead>
                            <TableHead className="px-5 text-right">
                                明細
                            </TableHead>
                            <TableHead className="px-5 text-right">
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
                                <TableCell className="px-5 py-3 align-top whitespace-nowrap">
                                    {formatDateTimeOrDash(receipt.createdAt)}
                                </TableCell>
                                <TableCell className="px-5 py-3 align-top">
                                    <span
                                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${receiptStatusClassNames[receipt.status]}`}
                                    >
                                        {receiptStatusLabels[receipt.status]}
                                    </span>
                                    {receipt.status === "failed" &&
                                    receipt.errorMessage !== null ? (
                                        <p className="mt-1 max-w-56 break-words text-xs text-destructive">
                                            {receipt.errorMessage}
                                        </p>
                                    ) : null}
                                </TableCell>
                                <TableCell className="max-w-48 break-words px-5 py-3 align-top">
                                    {receipt.storeName ?? "—"}
                                </TableCell>
                                <TableCell className="px-5 py-3 align-top whitespace-nowrap">
                                    {formatDateTimeOrDash(receipt.purchasedAt)}
                                </TableCell>
                                <TableCell className="px-5 py-3 text-right align-top whitespace-nowrap">
                                    {formatYen(receipt.totalPrice)}
                                </TableCell>
                                <TableCell className="px-5 py-3 text-right align-top">
                                    {receipt.lineCount}
                                </TableCell>
                                <TableCell className="px-5 py-3 text-right align-top">
                                    {/* アイコンボタンは行のテキストより背が高い。上下の
                                        余白を相殺して、他の列の文字と同じ高さに揃える */}
                                    <div className="-my-1 flex justify-end">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger
                                                render={
                                                    <Button
                                                        aria-label={`${receiptLabel(receipt)}の操作`}
                                                        size="icon-sm"
                                                        type="button"
                                                        variant="ghost"
                                                    >
                                                        <EllipsisIcon />
                                                    </Button>
                                                }
                                            />
                                            <DropdownMenuContent
                                                align="end"
                                                // 既定では trigger 幅に揃うため項目名が折り返す
                                                className="w-auto"
                                            >
                                                {/* Base UI では GroupLabel を Group の中に置く */}
                                                <DropdownMenuGroup>
                                                    <DropdownMenuLabel>
                                                        操作
                                                    </DropdownMenuLabel>
                                                    <DropdownMenuItem
                                                        render={
                                                            <Link
                                                                params={{
                                                                    receiptId:
                                                                        receipt.id,
                                                                }}
                                                                to="/receipts/$receiptId"
                                                            />
                                                        }
                                                    >
                                                        <FileTextIcon />
                                                        内容を見る
                                                    </DropdownMenuItem>
                                                    {/* 反映済みのレシートは確認画面へ戻さない */}
                                                    {receipt.status ===
                                                    "applied" ? null : (
                                                        <DropdownMenuItem
                                                            render={
                                                                <Link
                                                                    search={{
                                                                        receiptId:
                                                                            receipt.id,
                                                                    }}
                                                                    to="/receipts/new"
                                                                />
                                                            }
                                                        >
                                                            <PlayIcon />
                                                            続きから確認
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            copyReceiptId(
                                                                receipt,
                                                            )
                                                        }
                                                    >
                                                        <CopyIcon />
                                                        レシートIDをコピー
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    {/* 反映を開始したレシートは在庫の根拠として残す */}
                                                    <DropdownMenuItem
                                                        disabled={
                                                            deleting ||
                                                            receipt.status ===
                                                                "applied" ||
                                                            receipt.purchaseId !==
                                                                null
                                                        }
                                                        onClick={() =>
                                                            void removeReceipt(
                                                                receipt.id,
                                                            )
                                                        }
                                                        variant="destructive"
                                                    >
                                                        <Trash2Icon />
                                                        削除
                                                    </DropdownMenuItem>
                                                </DropdownMenuGroup>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
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
                <div aria-live="polite" className="sr-only">
                    <span key={copyMessage.seq}>{copyMessage.text}</span>
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
