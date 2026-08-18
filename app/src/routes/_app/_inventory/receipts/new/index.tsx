import {
    useMutation,
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
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
import {
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    type ReceiptApplyInput,
    type ReceiptApplyResult,
    type ReceiptDetailDto,
    receiptMaxByteSize,
} from "@/domain/receipt";
import {
    applyReceipt,
    parseReceipt,
    uploadReceiptImage,
} from "../-api/receipt-api";
import {
    categoryListQueryOptions,
    inventoryKeys,
    itemKeys,
    itemListQueryOptions,
    locationListQueryOptions,
    receiptDetailQueryOptions,
    receiptKeys,
    stockHistoryKeys,
} from "../-api/receipt-queries";
import {
    formatDateTimeOrDash,
    formatExpiryDate,
    formatYen,
    receiptStatusClassNames,
    receiptStatusLabels,
} from "../-functions/receipt-format";
import { ReceiptDropzone } from "./-components/receipt-dropzone";
import type { SelectOption } from "./-components/receipt-review-detail";
import { ReceiptReviewTable } from "./-components/receipt-review-table";
import { buildHierarchyLabels } from "./-functions/hierarchy-labels";
import { megabytes, validateFile } from "./-functions/receipt-file";
import {
    actionLabels,
    buildApplyInput,
    createReviewRows,
    indexReviewIssues,
    patchReviewRow,
    patchReviewRowNewItem,
    type ReceiptReviewField,
    type ReceiptReviewNewItemForm,
    type ReceiptReviewRow,
    receiptApplyIdempotencyKey,
    summarizeReviewTotals,
    validateReviewRows,
} from "./-functions/receipt-review-form";

// 取込途中のレシートを URL に持たせる。解析は最大 60 秒かかるため、
// 再読み込みやスマホの画面復帰で状態を失わないようにする。
const receiptSearchSchema = z.object({
    receiptId: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/_inventory/receipts/new/")({
    validateSearch: receiptSearchSchema,
    loaderDeps: ({ search }) => ({ receiptId: search.receiptId }),
    loader: async ({ context, deps }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(itemListQueryOptions()),
            context.queryClient.ensureQueryData(categoryListQueryOptions()),
            context.queryClient.ensureQueryData(locationListQueryOptions()),
        ]);
        // 削除済み・他人の ID を URL に貼られてもページ全体を落とさない。
        // 失敗は画面内の query が拾って表示する
        if (deps.receiptId !== undefined) {
            await context.queryClient
                .ensureQueryData(receiptDetailQueryOptions(deps.receiptId))
                .catch(() => undefined);
        }
    },
    staticData: {
        breadcrumbs: [
            { label: "レシート取込", to: "/receipts" },
            { label: "新規取込" },
        ],
    },
    component: ReceiptIntakePage,
    pendingComponent: ReceiptIntakePending,
    errorComponent: ReceiptIntakeError,
});

const pageClassName =
    "mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

const emptyIssueIndex: ReadonlyMap<
    string,
    Partial<Record<ReceiptReviewField, string>>
> = new Map();

function ReceiptIntakePage() {
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const queryClient = useQueryClient();
    const receiptId = search.receiptId ?? "";

    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const { data: categories } = useSuspenseQuery(categoryListQueryOptions());
    const { data: locations } = useSuspenseQuery(locationListQueryOptions());
    const detailQuery = useQuery(receiptDetailQueryOptions(receiptId));
    const receipt = detailQuery.data ?? null;

    const [file, setFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [parseError, setParseError] = useState<string | null>(null);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [applyResult, setApplyResult] = useState<ReceiptApplyResult | null>(
        null,
    );
    const [storeName, setStoreName] = useState("");
    const [note, setNote] = useState("");
    const [submitted, setSubmitted] = useState(false);
    // アップロード完了から解析開始までは mutation の isPending が両方 false になる。
    // その隙に 2 枚目を投入されるとレシートが二重に作られるため、取込全体を 1 つのフラグで覆う
    const [starting, setStarting] = useState(false);

    const uploadMutation = useMutation({
        mutationFn: (input: File) => uploadReceiptImage(input),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: receiptKeys.lists() }),
    });
    const parseMutation = useMutation({
        mutationFn: (input: string) => parseReceipt(input),
        onSuccess: (detail) => {
            queryClient.setQueryData(receiptKeys.detail(detail.id), detail);
            return queryClient.invalidateQueries({
                queryKey: receiptKeys.lists(),
            });
        },
    });
    // 反映は在庫・ロット・価格を動かすため、在庫系のキャッシュもまとめて無効化する
    const applyMutation = useMutation({
        mutationFn: (input: { receiptId: string; input: ReceiptApplyInput }) =>
            applyReceipt(input.receiptId, input.input),
        onSuccess: (result) => {
            queryClient.setQueryData(
                receiptKeys.detail(result.receipt.id),
                result.receipt,
            );
            return Promise.all([
                queryClient.invalidateQueries({
                    queryKey: receiptKeys.lists(),
                }),
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: stockHistoryKeys.all,
                }),
            ]);
        },
    });

    const uploading = uploadMutation.isPending;
    const parsing = parseMutation.isPending;
    const applying = applyMutation.isPending;

    const lines = receipt?.lines ?? emptyLines;
    // レシートが差し替わったとき（解析・再解析・反映）だけ入力状態を作り直す
    const rowsKey =
        receipt === null ? "" : `${receipt.id}:${receipt.updatedAt}`;
    const initialRows = useMemo(() => createReviewRows(lines), [lines]);
    const [rowsState, setRowsState] = useState<{
        key: string;
        rows: ReceiptReviewRow[];
    }>({ key: "", rows: [] });
    if (rowsState.key !== rowsKey) {
        setRowsState({ key: rowsKey, rows: initialRows });
    }
    const rows = rowsState.key === rowsKey ? rowsState.rows : initialRows;

    const itemOptions = useMemo<SelectOption[]>(
        () => items.map((item) => ({ label: item.name, value: item.id })),
        [items],
    );
    const categoryOptions = useMemo<SelectOption[]>(() => {
        const labels = buildHierarchyLabels(categories);
        return categories.map((category) => ({
            label: labels.get(category.id) ?? category.name,
            value: category.id,
        }));
    }, [categories]);
    const locationOptions = useMemo<SelectOption[]>(() => {
        const labels = buildHierarchyLabels(locations);
        return locations.map((location) => ({
            label: labels.get(location.id) ?? location.name,
            value: location.id,
        }));
    }, [locations]);

    const totals = useMemo(() => summarizeReviewTotals(rows), [rows]);
    const issues = useMemo(() => validateReviewRows(rows), [rows]);
    const issueIndex = useMemo(
        () => (submitted ? indexReviewIssues(issues) : emptyIssueIndex),
        [issues, submitted],
    );
    const storeNameError =
        submitted &&
        receipt !== null &&
        receipt.storeName === null &&
        receipt.purchaseId === null &&
        storeName.trim() === ""
            ? "レシートから店舗名を読み取れませんでした。店舗名を入力してください"
            : null;

    // data table のセルへ渡すハンドラ。参照が変わるとセルが再マウントされ、
    // 入力中のフォーカスと IME の変換が途切れるため useCallback で固定する
    const updateRow = useCallback(
        (lineId: string, patch: Partial<ReceiptReviewRow>) => {
            setRowsState((current) => ({
                key: current.key,
                rows: patchReviewRow(current.rows, lineId, patch),
            }));
        },
        [],
    );
    const updateRowNewItem = useCallback(
        (lineId: string, patch: Partial<ReceiptReviewNewItemForm>) => {
            setRowsState((current) => ({
                key: current.key,
                rows: patchReviewRowNewItem(current.rows, lineId, patch),
            }));
        },
        [],
    );

    const runParse = async (id: string) => {
        setParseError(null);
        try {
            await parseMutation.mutateAsync(id);
        } catch (cause) {
            setParseError(
                errorMessage(cause, "レシートを解析できませんでした"),
            );
        }
    };

    // 画像を選んだ時点で解析まで進める。失敗したときだけ再試行ボタンを出す
    const startUpload = async (target: File) => {
        if (starting) return;
        setUploadError(null);
        setParseError(null);
        const invalid = validateFile(target);
        setFileError(invalid);
        if (invalid !== null) return;
        setStarting(true);
        try {
            const created = await uploadMutation.mutateAsync(target);
            setFile(null);
            setApplyResult(null);
            setSubmitted(false);
            await navigate({
                replace: true,
                search: { receiptId: created.id },
            });
            await runParse(created.id);
        } catch (cause) {
            setUploadError(
                errorMessage(
                    cause,
                    "レシート画像をアップロードできませんでした",
                ),
            );
        } finally {
            setStarting(false);
        }
    };

    const handleFileSelect = (selected: File) => {
        setFile(selected);
        setFileError(null);
        setUploadError(null);
        void startUpload(selected);
    };

    const handleFileReject = (message: string) => {
        setFile(null);
        setFileError(message);
        setUploadError(null);
    };

    const handleFileClear = () => {
        setFile(null);
        setFileError(null);
        setUploadError(null);
    };

    const submitApply = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitted(true);
        setApplyError(null);
        if (receipt === null) return;
        const built = buildApplyInput({
            idempotencyKey: receiptApplyIdempotencyKey(receipt.id),
            receiptStoreName: receipt.storeName,
            purchaseRecorded: receipt.purchaseId !== null,
            storeNameInput: storeName,
            note,
            rows,
        });
        if (!built.ok) {
            setApplyError(
                built.storeNameError ??
                    "入力内容を確認してください。赤字の項目を直すと反映できます。",
            );
            return;
        }
        try {
            const result = await applyMutation.mutateAsync({
                receiptId: receipt.id,
                input: built.input,
            });
            setApplyResult(result);
        } catch (cause) {
            setApplyError(
                errorMessage(cause, "レシートの内容を反映できませんでした"),
            );
        }
    };

    const detailError = detailQuery.error
        ? errorMessage(detailQuery.error, "レシートを読み込めませんでした")
        : null;
    const appliedCount = rows.filter((row) => row.action !== "skip").length;
    const busy = starting || uploading || parsing || applying;
    const canRetryUpload = uploadError !== null && file !== null;

    return (
        <main className={pageClassName}>
            <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        Inventory
                    </p>
                    <h1 className="mt-1 text-2xl font-bold">レシート取込</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        レシート画像を読み取り、1
                        行ずつ確認してから購入・在庫へ反映します。承認するまで在庫は変わりません。
                    </p>
                </div>
                <Button
                    render={
                        // biome-ignore lint/a11y/useAnchorContent: Base UI forwards Button children to this anchor.
                        <a aria-label="取込履歴" href="/receipts" />
                    }
                    size="sm"
                    variant="outline"
                >
                    取込履歴
                </Button>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle>1. レシート画像を取り込む</CardTitle>
                    <CardDescription>
                        画像を選ぶとそのままアップロードして解析します。JPEG・PNG・WebP
                        の画像を {megabytes(receiptMaxByteSize)}{" "}
                        まで受け付けます。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ReceiptDropzone
                        disabled={busy}
                        error={fileError}
                        file={file}
                        onClear={handleFileClear}
                        onReject={handleFileReject}
                        onSelect={handleFileSelect}
                        statusMessage={
                            uploading
                                ? "レシート画像をアップロードしています…"
                                : parsing
                                  ? "レシートを解析しています…"
                                  : starting
                                    ? "レシートを取り込んでいます…"
                                    : null
                        }
                    />
                </CardContent>
                {receiptId === "" && !canRetryUpload ? null : (
                    <CardFooter className="justify-end gap-2">
                        {receiptId === "" ? null : (
                            <Button
                                disabled={busy}
                                onClick={() => {
                                    setApplyResult(null);
                                    setSubmitted(false);
                                    void navigate({
                                        replace: true,
                                        search: {},
                                    });
                                }}
                                type="button"
                                variant="ghost"
                            >
                                取込をやめる
                            </Button>
                        )}
                        {canRetryUpload ? (
                            <Button
                                disabled={busy}
                                onClick={() => {
                                    if (file !== null) void startUpload(file);
                                }}
                                type="button"
                            >
                                もう一度アップロード
                            </Button>
                        ) : null}
                    </CardFooter>
                )}
            </Card>

            {uploadError ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {uploadError}
                </div>
            ) : null}
            {detailError ? (
                <div
                    aria-live="assertive"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{detailError}</span>
                    <Button
                        onClick={() => void detailQuery.refetch()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                </div>
            ) : null}

            {receipt === null ? null : (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex flex-wrap items-center gap-2">
                            2. 読み取り結果
                            <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${receiptStatusClassNames[receipt.status]}`}
                            >
                                {receiptStatusLabels[receipt.status]}
                            </span>
                        </CardTitle>
                        <CardDescription>
                            AI
                            の読み取り結果です。誤りがあれば次の確認欄で直せます。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        <dl className="grid gap-3 sm:grid-cols-2">
                            <SummaryItem
                                label="店舗"
                                value={receipt.storeName ?? "—"}
                            />
                            <SummaryItem
                                label="購入日時"
                                value={formatDateTimeOrDash(
                                    receipt.purchasedAt,
                                )}
                            />
                            <SummaryItem
                                label="レシート記載の合計"
                                value={formatYen(receipt.totalPrice)}
                            />
                            <SummaryItem
                                label="明細"
                                value={`${receipt.lineCount} 行`}
                            />
                        </dl>
                        {receipt.status === "failed" ? (
                            <div
                                aria-live="assertive"
                                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                                role="alert"
                            >
                                {receipt.errorMessage ??
                                    "レシートを解析できませんでした。"}
                            </div>
                        ) : null}
                        {parseError ? (
                            <div
                                aria-live="assertive"
                                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                                role="alert"
                            >
                                {parseError}
                            </div>
                        ) : null}
                        {receipt.status === "parsing" ? (
                            <p
                                aria-live="polite"
                                className="text-sm text-muted-foreground"
                            >
                                解析中です。時間がかかる場合は、もう一度解析を実行してください。
                            </p>
                        ) : null}
                    </CardContent>
                    {receipt.status === "applied" ||
                    receipt.purchaseId !== null ? null : (
                        <CardFooter className="justify-end">
                            <Button
                                disabled={busy}
                                onClick={() => void runParse(receipt.id)}
                                type="button"
                                variant="outline"
                            >
                                {parsing
                                    ? "解析中…"
                                    : receipt.status === "parsed"
                                      ? "もう一度解析する"
                                      : "解析する"}
                            </Button>
                        </CardFooter>
                    )}
                </Card>
            )}

            {receipt !== null && receipt.status === "parsed" ? (
                <form onSubmit={submitApply}>
                    <Card>
                        <CardHeader>
                            <CardTitle>3. 明細を確認して反映</CardTitle>
                            <CardDescription>
                                反映方法・数量・金額・期限を行ごとに確認します。「反映する」を押すまで在庫は変わりません。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-5">
                            {receipt.storeName === null ? (
                                <Field data-invalid={Boolean(storeNameError)}>
                                    <FieldLabel htmlFor="receipt-store-name">
                                        店舗名
                                    </FieldLabel>
                                    <Input
                                        aria-describedby={
                                            storeNameError
                                                ? "receipt-store-name-description receipt-store-name-error"
                                                : "receipt-store-name-description"
                                        }
                                        aria-invalid={Boolean(storeNameError)}
                                        disabled={applying}
                                        id="receipt-store-name"
                                        maxLength={200}
                                        onChange={(event) =>
                                            setStoreName(event.target.value)
                                        }
                                        value={storeName}
                                    />
                                    <FieldDescription id="receipt-store-name-description">
                                        購入記録に残す店舗名です。レシートから読み取れなかったため入力が必要です。
                                    </FieldDescription>
                                    {storeNameError ? (
                                        <FieldError id="receipt-store-name-error">
                                            {storeNameError}
                                        </FieldError>
                                    ) : null}
                                </Field>
                            ) : null}

                            {lines.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    明細がありません。画像を撮り直して再解析してください。
                                </p>
                            ) : (
                                <ReceiptReviewTable
                                    categoryOptions={categoryOptions}
                                    disabled={applying}
                                    issueIndex={issueIndex}
                                    itemOptions={itemOptions}
                                    lines={lines}
                                    locationOptions={locationOptions}
                                    onChange={updateRow}
                                    onNewItemChange={updateRowNewItem}
                                    rows={rows}
                                />
                            )}

                            <Field>
                                <FieldLabel htmlFor="receipt-note">
                                    メモ（任意）
                                </FieldLabel>
                                <textarea
                                    className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
                                    disabled={applying}
                                    id="receipt-note"
                                    maxLength={2000}
                                    onChange={(event) =>
                                        setNote(event.target.value)
                                    }
                                    value={note}
                                />
                            </Field>

                            <dl className="grid gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm sm:grid-cols-3">
                                <SummaryItem
                                    label="レシート記載の合計"
                                    value={formatYen(receipt.totalPrice)}
                                />
                                <SummaryItem
                                    label="明細の合計"
                                    value={
                                        totals.lineTotal === null
                                            ? "計算できません"
                                            : formatYen(totals.lineTotal)
                                    }
                                />
                                <SummaryItem
                                    label="反映する行の合計"
                                    value={
                                        totals.appliedTotal === null
                                            ? "計算できません"
                                            : formatYen(totals.appliedTotal)
                                    }
                                />
                            </dl>
                            <p
                                aria-live="polite"
                                className="text-sm text-muted-foreground"
                            >
                                {reconcileMessage(receipt, totals)}
                            </p>
                        </CardContent>
                        <CardFooter className="flex-col items-stretch gap-3">
                            {applyError ? (
                                <div
                                    aria-live="assertive"
                                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                                    role="alert"
                                >
                                    {applyError}
                                </div>
                            ) : null}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-muted-foreground">
                                    {appliedCount} / {rows.length}{" "}
                                    行を在庫へ反映します。
                                </p>
                                <Button
                                    disabled={applying || rows.length === 0}
                                    type="submit"
                                >
                                    {applying
                                        ? "反映中…"
                                        : applyError
                                          ? "反映を再送"
                                          : "確認した内容で反映する"}
                                </Button>
                            </div>
                        </CardFooter>
                    </Card>
                </form>
            ) : null}

            {applyResult === null ? null : (
                <Card>
                    <CardHeader>
                        <CardTitle>反映しました</CardTitle>
                        <CardDescription>
                            {formatDateTimeOrDash(applyResult.appliedAt)}{" "}
                            に購入として記録しました。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>明細</TableHead>
                                        <TableHead>反映方法</TableHead>
                                        <TableHead className="text-right">
                                            数量
                                        </TableHead>
                                        <TableHead>期限</TableHead>
                                        <TableHead>備考</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {applyResult.lines.map((resultLine) => {
                                        const line = lines.find(
                                            (candidate) =>
                                                candidate.id ===
                                                resultLine.lineId,
                                        );
                                        return (
                                            <TableRow key={resultLine.lineId}>
                                                <TableCell className="max-w-56 break-words align-top">
                                                    {line?.rawName ??
                                                        resultLine.lineId}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    {
                                                        actionLabels[
                                                            resultLine.action
                                                        ]
                                                    }
                                                </TableCell>
                                                <TableCell className="text-right align-top">
                                                    {resultLine.action ===
                                                    "skip"
                                                        ? "—"
                                                        : resultLine.quantity}
                                                </TableCell>
                                                <TableCell className="align-top whitespace-nowrap">
                                                    {resultLine.action ===
                                                    "skip"
                                                        ? "—"
                                                        : resultLine.expiryDate ===
                                                            null
                                                          ? "期限なし"
                                                          : formatDateTimeOrDash(
                                                                resultLine.expiryDate,
                                                            )}
                                                </TableCell>
                                                <TableCell className="align-top">
                                                    {resultNotes(resultLine)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                    <CardFooter className="justify-end gap-2">
                        <Button
                            onClick={() => {
                                setApplyResult(null);
                                setSubmitted(false);
                                setStoreName("");
                                setNote("");
                                void navigate({ replace: true, search: {} });
                            }}
                            type="button"
                            variant="outline"
                        >
                            次のレシートを取り込む
                        </Button>
                        <Button
                            render={
                                // biome-ignore lint/a11y/useAnchorContent: Base UI forwards Button children to this anchor.
                                <a
                                    aria-label="在庫一覧を見る"
                                    href="/inventory"
                                />
                            }
                        >
                            在庫一覧を見る
                        </Button>
                    </CardFooter>
                </Card>
            )}

            {receipt !== null &&
            receipt.status === "applied" &&
            applyResult === null ? (
                <Card>
                    <CardHeader>
                        <CardTitle>反映済みの明細</CardTitle>
                        <CardDescription>
                            このレシートは
                            {formatDateTimeOrDash(receipt.appliedAt)}
                            に反映済みです。もう一度反映することはできません。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>明細</TableHead>
                                        <TableHead className="text-right">
                                            数量
                                        </TableHead>
                                        <TableHead className="text-right">
                                            金額
                                        </TableHead>
                                        <TableHead>反映先</TableHead>
                                        <TableHead>
                                            期限（読み取り値）
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {lines.map((line) => (
                                        <TableRow key={line.id}>
                                            <TableCell className="max-w-56 break-words align-top">
                                                {line.rawName}
                                            </TableCell>
                                            <TableCell className="text-right align-top">
                                                {line.quantity}
                                            </TableCell>
                                            <TableCell className="text-right align-top whitespace-nowrap">
                                                {formatYen(line.price)}
                                            </TableCell>
                                            <TableCell className="align-top">
                                                {line.matchedItemName ?? "—"}
                                            </TableCell>
                                            <TableCell className="align-top whitespace-nowrap">
                                                {formatExpiryDate(
                                                    line.suggestedExpiryDate,
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            ) : null}
        </main>
    );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm font-medium">{value}</dd>
        </div>
    );
}

function ReceiptIntakePending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                レシート取込の準備をしています…
            </p>
        </main>
    );
}

function ReceiptIntakeError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {errorMessage(error, "レシート取込を開けませんでした")}
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

const emptyLines: ReceiptDetailDto["lines"] = [];

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

/** レシート記載の合計と明細合計の突き合わせ。ずれても反映は止めない。 */
const reconcileMessage = (
    receipt: ReceiptDetailDto,
    totals: ReturnType<typeof summarizeReviewTotals>,
): string => {
    if (totals.hasInvalidPrice) {
        return "金額に数字以外が入っている行があります。";
    }
    if (totals.missingPriceCount > 0) {
        return `金額が未入力の明細が ${totals.missingPriceCount} 行あるため、合計を突き合わせられません。`;
    }
    if (receipt.totalPrice === null || totals.lineTotal === null) {
        return "レシート記載の合計を読み取れなかったため、突き合わせできません。";
    }
    const diff = totals.lineTotal - receipt.totalPrice;
    if (diff === 0) return "レシート記載の合計と明細の合計は一致しています。";
    return `明細の合計がレシート記載より ${formatYen(Math.abs(diff))} ${
        diff > 0 ? "多い" : "少ない"
    }です。値引きや税の扱いを確認してください。`;
};

const resultNotes = (line: ReceiptApplyResult["lines"][number]): string => {
    if (line.action === "skip") return "取り込みませんでした";
    const notes: string[] = [];
    if (line.itemCreated) notes.push("品目を新規作成");
    if (line.replayed) notes.push("反映済みのため再計上せず");
    notes.push(line.priceRecorded ? "価格履歴に記録" : "価格履歴なし");
    if (line.aliasRegistered) notes.push("表記を辞書へ登録");
    return notes.join(" / ");
};
