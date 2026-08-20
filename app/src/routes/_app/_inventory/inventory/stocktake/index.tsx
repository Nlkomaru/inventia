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
import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
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
    type ItemLotDto,
    type LotAllocationDto,
    planStocktakeLots,
} from "@/domain/lot";
import { formatDisplayDateTime } from "@/lib/datetime";
import { recordStocktake } from "./-api/stock-api";
import {
    inventoryKeys,
    itemKeys,
    itemListQueryOptions,
    itemLotsQueryOptions,
    stockHistoryKeys,
} from "./-api/stock-queries";
import { StocktakeRow } from "./-components/stocktake-row";
import {
    buildStocktakeLots,
    type StocktakeRowInput,
    type StocktakeRowIssue,
} from "./-functions/stocktake-rows";

export const Route = createFileRoute("/_app/_inventory/inventory/stocktake/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(itemListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "棚卸・調整" }],
    },
    component: StocktakePage,
    pendingComponent: StocktakePending,
    errorComponent: StocktakeError,
});

const pageClassName = "w-full space-y-6 p-4 sm:p-6 lg:p-8";

// 未取得時の既定値は参照を固定する。毎描画で新しい配列を作ると
// ロットに依存する useMemo が毎回作り直される
const noLots: ItemLotDto[] = [];

const toRows = (lots: readonly ItemLotDto[]): StocktakeRowInput[] =>
    lots.map((lot) => ({
        key: lot.id,
        expiryDate: lot.expiryDate,
        expiryInput: null,
        quantity: String(lot.quantity),
    }));

type StocktakeSubmitInput = {
    itemId: string;
    lots: { expiryDate: string | null; quantity: number }[];
    idempotencyKey: string;
};

function StocktakePage() {
    const queryClient = useQueryClient();
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const [selectedItemId, setSelectedItemId] = useState("");
    const lotsQuery = useQuery(itemLotsQueryOptions(selectedItemId));
    const lots = lotsQuery.data ?? noLots;
    // 入力行は選択中の品目のロットを読み込めた時点で 1 度だけ作る。
    // 背景での再取得（フォーカス復帰や他クライアントの在庫変動）で作り直すと
    // 入力途中の実棚数が消えるため、品目を切り替えたときと送信後だけ作り直す。
    const [rowsState, setRowsState] = useState<{
        itemId: string;
        built: boolean;
        rows: StocktakeRowInput[];
    }>({ itemId: "", built: false, rows: [] });
    if (rowsState.itemId !== selectedItemId) {
        setRowsState({
            itemId: selectedItemId,
            built: lotsQuery.isSuccess,
            rows: lotsQuery.isSuccess ? toRows(lots) : [],
        });
    } else if (!rowsState.built && lotsQuery.isSuccess) {
        setRowsState({
            itemId: selectedItemId,
            built: true,
            rows: toRows(lots),
        });
    }
    const rows = rowsState.rows;
    const updateRows = (
        updater: (current: StocktakeRowInput[]) => StocktakeRowInput[],
    ) =>
        setRowsState((current) => ({
            itemId: current.itemId,
            built: current.built,
            rows: updater(current.rows),
        }));
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [rowIssues, setRowIssues] = useState<StocktakeRowIssue[]>([]);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<LotAllocationDto[]>([]);
    // 送信内容が同じ限り同じ idempotency key で再送し、二重の棚卸しを防ぐ
    const pendingKey = useRef<{
        signature: string;
        value: string;
    } | null>(null);

    // 棚卸しはロット構成・品目の在庫数・在庫履歴を同時に変えるため、関係する query をまとめて無効化する。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const stocktakeMutation = useMutation({
        mutationFn: ({ itemId, ...input }: StocktakeSubmitInput) =>
            recordStocktake(itemId, input),
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: stockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({
                    queryKey: inventoryKeys.all,
                }),
            ]),
    });
    const saving = stocktakeMutation.isPending;
    const lotsLoading = lotsQuery.isLoading;
    const lotsError = lotsQuery.error
        ? errorMessage(lotsQuery.error, "ロットを読み込めませんでした")
        : null;

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const built = useMemo(() => buildStocktakeLots(rows), [rows]);
    // 確定内容はドメインの計画関数で作る。リストから外した既存ロットも 0 として現れる
    const plan = useMemo(
        () => (built.ok ? planStocktakeLots(lots, built.lots) : []),
        [built, lots],
    );
    const currentTotal = useMemo(
        () => lots.reduce((total, lot) => total + lot.quantity, 0),
        [lots],
    );
    const inputTotal = built.ok ? built.total : null;

    const resetFeedback = () => {
        setSelectionError(null);
        setRowIssues([]);
        setSubmitError(null);
        setNotice(null);
        setAllocations([]);
        pendingKey.current = null;
    };

    const handleItemChange = (value: string | null) => {
        setSelectedItemId(value ?? "");
        resetFeedback();
    };

    const updateRow = (key: string, patch: Partial<StocktakeRowInput>) => {
        updateRows((current) =>
            current.map((row) =>
                row.key === key ? { ...row, ...patch } : row,
            ),
        );
        resetFeedback();
    };

    const addRow = () => {
        updateRows((current) => [
            ...current,
            {
                key: crypto.randomUUID(),
                expiryDate: null,
                expiryInput: "",
                quantity: "0",
            },
        ]);
        resetFeedback();
    };

    const removeRow = (key: string) => {
        updateRows((current) => current.filter((row) => row.key !== key));
        resetFeedback();
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSelectionError(null);
        setRowIssues([]);
        setSubmitError(null);
        setNotice(null);

        if (!selectedItem) {
            setSelectionError("品目を選択してください");
            return;
        }
        if (!built.ok) {
            setRowIssues(built.issues);
            return;
        }

        const signature = JSON.stringify({
            itemId: selectedItem.id,
            lots: built.lots,
        });
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };
        try {
            const result = await stocktakeMutation.mutateAsync({
                itemId: selectedItem.id,
                lots: built.lots,
                idempotencyKey,
            });
            // onSuccess の invalidateQueries を mutateAsync が待つため、ここでは
            // ロットのキャッシュが更新済み。built を落として入力行を作り直させる
            setRowsState({
                itemId: selectedItem.id,
                built: false,
                rows: [],
            });
            setAllocations(result.allocations);
            pendingKey.current = null;
            if (result.replayed) {
                setNotice(
                    result.movement
                        ? "棚卸し結果を再表示しました（再送）。"
                        : "棚卸し結果を再表示しました。差分はなく、在庫は変わっていません。",
                );
            } else if (result.movement === null) {
                setNotice(
                    "棚卸しを記録しました。差分はなく、在庫は変わっていません。",
                );
            } else {
                setNotice(
                    "棚卸しを記録しました。在庫履歴に差分を記録しました。",
                );
            }
        } catch (cause) {
            setSubmitError(errorMessage(cause, "棚卸しを記録できませんでした"));
        }
    };

    const itemOptions = items.map((item) => ({
        label: item.name,
        value: item.id,
    }));
    const baseUnit = selectedItem?.baseUnit ?? "—";

    return (
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">棚卸・調整</h1>
            </header>

            <section aria-labelledby="stocktake-form-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 className="font-bold" id="stocktake-form-title">
                        棚卸しを記録
                    </h2>
                </div>
                <form className="flex flex-col gap-6" onSubmit={submit}>
                    <FieldGroup>
                        <Field data-invalid={Boolean(selectionError)}>
                            <FieldLabel htmlFor="stocktake-item">
                                品目
                            </FieldLabel>
                            <Select
                                disabled={items.length === 0}
                                items={itemOptions}
                                onValueChange={handleItemChange}
                                value={selectedItemId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={
                                        selectionError
                                            ? "stocktake-item-error"
                                            : undefined
                                    }
                                    aria-invalid={Boolean(selectionError)}
                                    className="w-full"
                                    id="stocktake-item"
                                >
                                    <SelectValue
                                        placeholder={
                                            items.length === 0
                                                ? "品目がありません"
                                                : "品目を選択"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {itemOptions.map((option) => (
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
                            {selectionError ? (
                                <FieldError id="stocktake-item-error">
                                    {selectionError}
                                </FieldError>
                            ) : null}
                        </Field>

                        {selectedItem ? (
                            <div className="grid gap-4 sm:grid-cols-3">
                                <div>
                                    <p className="text-sm text-muted-foreground">
                                        現在庫（合計）
                                    </p>
                                    <p
                                        aria-live="polite"
                                        className="mt-1 text-xl font-semibold"
                                    >
                                        {currentTotal} {baseUnit}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">
                                        入力の合計
                                    </p>
                                    <p
                                        aria-live="polite"
                                        className="mt-1 text-xl font-semibold"
                                    >
                                        {inputTotal === null
                                            ? "—"
                                            : `${inputTotal} ${baseUnit}`}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">
                                        差分
                                    </p>
                                    <p
                                        aria-live="polite"
                                        className="mt-1 text-xl font-semibold"
                                    >
                                        {inputTotal === null
                                            ? "—"
                                            : `${formatDelta(inputTotal - currentTotal)} ${baseUnit}`}
                                    </p>
                                </div>
                            </div>
                        ) : null}

                        <Field>
                            <FieldLabel htmlFor="stocktake-rows">
                                期限ごとの実在庫（絶対数量）
                            </FieldLabel>
                            <FieldDescription id="stocktake-rows-description">
                                <strong className="font-semibold">
                                    この一覧から外した既存ロットは 0
                                    になります。
                                </strong>
                            </FieldDescription>
                            <div
                                aria-describedby="stocktake-rows-description"
                                className="flex flex-col gap-3"
                                id="stocktake-rows"
                            >
                                {lotsError ? (
                                    <div
                                        aria-live="polite"
                                        className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                                        role="alert"
                                    >
                                        <span>{lotsError}</span>
                                        <Button
                                            onClick={() =>
                                                void lotsQuery.refetch()
                                            }
                                            size="sm"
                                            type="button"
                                            variant="outline"
                                        >
                                            再読み込み
                                        </Button>
                                    </div>
                                ) : null}
                                {!selectedItem ? (
                                    <p className="text-sm text-muted-foreground">
                                        品目を選ぶと、期限ごとの行を表示します。
                                    </p>
                                ) : lotsLoading ? (
                                    <p className="text-sm text-muted-foreground">
                                        ロットを読み込み中…
                                    </p>
                                ) : rows.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        行がありません。この状態で記録すると在庫は
                                        0 になります。
                                    </p>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>期限</TableHead>
                                                <TableHead className="text-right">
                                                    現在庫
                                                </TableHead>
                                                <TableHead>実在庫</TableHead>
                                                <TableHead className="text-right">
                                                    操作
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {rows.map((row, index) => (
                                                <StocktakeRow
                                                    baseUnit={baseUnit}
                                                    currentQuantity={currentLotQuantity(
                                                        lots,
                                                        row,
                                                    )}
                                                    disabled={saving}
                                                    expiryError={issueMessage(
                                                        rowIssues,
                                                        row.key,
                                                        "expiry",
                                                    )}
                                                    formatExpiry={formatExpiry}
                                                    key={row.key}
                                                    onChange={(patch) =>
                                                        updateRow(
                                                            row.key,
                                                            patch,
                                                        )
                                                    }
                                                    onRemove={() =>
                                                        removeRow(row.key)
                                                    }
                                                    position={index + 1}
                                                    quantityError={issueMessage(
                                                        rowIssues,
                                                        row.key,
                                                        "quantity",
                                                    )}
                                                    row={row}
                                                />
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                                <div>
                                    <Button
                                        disabled={!selectedItem || saving}
                                        onClick={addRow}
                                        size="sm"
                                        type="button"
                                        variant="outline"
                                    >
                                        <Plus data-icon="inline-start" />
                                        期限を追加
                                    </Button>
                                </div>
                            </div>
                        </Field>
                    </FieldGroup>
                    <div className="flex justify-end">
                        {/* 現在のロットを読めていない状態では送信させない。
                            行が空の送信は「全ロットを 0 にする」指定になるため、
                            読み込み失敗と利用者の意図を取り違えてはならない */}
                        <Button
                            disabled={
                                saving ||
                                lotsLoading ||
                                lotsQuery.isError ||
                                !selectedItem
                            }
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "棚卸しを再送"
                                  : "棚卸しを記録"}
                        </Button>
                    </div>
                </form>
            </section>

            {selectedItem ? (
                <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                    <div className="border-b p-5">
                        <h2 className="font-bold">確定内容</h2>
                    </div>
                    <output aria-live="polite" className="block">
                        {!built.ok ? (
                            <p className="p-5 text-sm text-muted-foreground">
                                入力を修正すると確定内容を表示します。
                            </p>
                        ) : plan.length === 0 ? (
                            <p className="p-5 text-sm text-muted-foreground">
                                変更はありません。
                            </p>
                        ) : (
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead className="px-5">
                                            期限
                                        </TableHead>
                                        <TableHead className="px-5 text-right">
                                            確定後
                                        </TableHead>
                                        <TableHead className="px-5 text-right">
                                            差分
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {plan.map((entry) => (
                                        <TableRow
                                            key={entry.expiryDate ?? "none"}
                                        >
                                            <TableCell className="px-5 py-3">
                                                {formatExpiry(entry.expiryDate)}
                                            </TableCell>
                                            <TableCell className="px-5 py-3 text-right">
                                                {entry.quantity} {baseUnit}
                                            </TableCell>
                                            <TableCell className="px-5 py-3 text-right">
                                                {formatDelta(entry.delta)}{" "}
                                                {baseUnit}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </output>
                </section>
            ) : null}

            {submitError ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {submitError}
                </div>
            ) : null}
            {notice ? (
                <output
                    aria-live="polite"
                    className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm"
                >
                    <span>{notice}</span>
                    {allocations.length > 0 ? (
                        <ul className="flex flex-col gap-1 text-muted-foreground">
                            {allocations.map((allocation) => (
                                <li key={allocation.lotId}>
                                    {formatExpiry(allocation.expiryDate)}:{" "}
                                    {formatDelta(allocation.delta)} {baseUnit}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </output>
            ) : null}
        </main>
    );
}

function StocktakePending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function StocktakeError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="polite"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>{errorMessage(error, "品目を読み込めませんでした")}</span>
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

// 行の key は既存ロットの id なので、新しい期限の行には現在庫がない
const currentLotQuantity = (
    lots: readonly ItemLotDto[],
    row: StocktakeRowInput,
): number | null => {
    if (row.expiryInput !== null) return null;
    const lot = lots.find((candidate) => candidate.id === row.key);
    return lot ? lot.quantity : null;
};

const issueMessage = (
    issues: readonly StocktakeRowIssue[],
    key: string,
    field: StocktakeRowIssue["field"],
): string | null =>
    issues.find((issue) => issue.key === key && issue.field === field)
        ?.message ?? null;

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";

const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
