import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ItemDto } from "@/domain/item";
import {
    earliestExpiryDate,
    type ItemLotDto,
    type LotAllocationDto,
    planStocktakeLots,
} from "@/domain/lot";
import {
    listItemLots,
    listItems,
    recordStocktake,
} from "./-components/stock-api";
import { StocktakeRow } from "./-components/stocktake-row";
import {
    buildStocktakeLots,
    type StocktakeRowInput,
    type StocktakeRowIssue,
} from "./-functions/stocktake-rows";

export const Route = createFileRoute("/_app/_inventory/inventory/stocktake/")({
    staticData: {
        breadcrumbs: [{ label: "棚卸・調整" }],
    },
    component: StocktakePage,
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
});

const toRows = (lots: readonly ItemLotDto[]): StocktakeRowInput[] =>
    lots.map((lot) => ({
        key: lot.id,
        expiryDate: lot.expiryDate,
        expiryInput: null,
        quantity: String(lot.quantity),
    }));

function StocktakePage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [selectedItemId, setSelectedItemId] = useState("");
    const [lots, setLots] = useState<ItemLotDto[]>([]);
    const [rows, setRows] = useState<StocktakeRowInput[]>([]);
    const [loading, setLoading] = useState(true);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [lotsError, setLotsError] = useState<string | null>(null);
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

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setItems(await listItems());
        } catch (cause) {
            setLoadError(errorMessage(cause, "品目を読み込めませんでした"));
        } finally {
            setLoading(false);
        }
    }, []);

    const loadLots = useCallback(async (itemId: string) => {
        setLotsLoading(true);
        setLotsError(null);
        try {
            const nextLots = await listItemLots(itemId);
            setLots(nextLots);
            setRows(toRows(nextLots));
        } catch (cause) {
            setLots([]);
            setRows([]);
            setLotsError(errorMessage(cause, "ロットを読み込めませんでした"));
        } finally {
            setLotsLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!selectedItemId) {
            setLots([]);
            setRows([]);
            setLotsError(null);
            return;
        }
        void loadLots(selectedItemId);
    }, [loadLots, selectedItemId]);

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
        setRows((current) =>
            current.map((row) =>
                row.key === key ? { ...row, ...patch } : row,
            ),
        );
        resetFeedback();
    };

    const addRow = () => {
        setRows((current) => [
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
        setRows((current) => current.filter((row) => row.key !== key));
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
        setSaving(true);
        try {
            const result = await recordStocktake(selectedItem.id, {
                lots: built.lots,
                idempotencyKey,
            });
            setLots(result.lots);
            setRows(toRows(result.lots));
            setItems((current) =>
                current.map((item) =>
                    item.id === result.itemId
                        ? {
                              ...item,
                              currentQuantity: result.currentQuantity,
                              earliestExpiryDate: earliestExpiryDate(
                                  result.lots,
                              ),
                              lotCount: result.lots.length,
                          }
                        : item,
                ),
            );
            setAllocations(result.allocations);
            pendingKey.current = null;
            if (result.replayed) {
                setNotice(
                    result.movement
                        ? "棚卸し結果を再表示しました（再送）。"
                        : "棚卸し結果を再表示しました。差分はなく、在庫は変わっていません（再送・no-op）。",
                );
            } else if (result.movement === null) {
                setNotice(
                    "棚卸しを記録しました。差分はなく、在庫は変わっていません（no-op）。",
                );
            } else {
                setNotice(
                    "棚卸しを記録しました。在庫履歴に差分を記録しました。",
                );
            }
        } catch (cause) {
            setSubmitError(errorMessage(cause, "棚卸しを記録できませんでした"));
        } finally {
            setSaving(false);
        }
    };

    const itemOptions = items.map((item) => ({
        label: item.name,
        value: item.id,
    }));
    const baseUnit = selectedItem?.baseUnit ?? "—";

    return (
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold">棚卸・調整</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    期限ごとの実在庫を入力し、帳簿上の在庫との差分を履歴へ記録します。
                </p>
            </header>

            {loadError ? (
                <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{loadError}</span>
                    <Button
                        onClick={() => void load()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>棚卸しを記録</CardTitle>
                    <CardDescription>
                        品目を選び、期限ごとに現在確認できる絶対数量を入力してください。
                    </CardDescription>
                </CardHeader>
                <form onSubmit={submit}>
                    <CardContent>
                        <FieldGroup>
                            <Field data-invalid={Boolean(selectionError)}>
                                <FieldLabel htmlFor="stocktake-item">
                                    品目
                                </FieldLabel>
                                <Select
                                    disabled={loading || items.length === 0}
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
                                                loading
                                                    ? "品目を読み込み中…"
                                                    : items.length === 0
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
                                <div className="grid gap-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-3">
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
                                    棚卸しは全数確定です。
                                    <strong className="font-semibold">
                                        この一覧から外した既存ロットは 0
                                        になります。
                                    </strong>
                                    数えられなかったロットは、行を残して現在の数量を入力してください。
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
                                                    selectedItemId
                                                        ? void loadLots(
                                                              selectedItemId,
                                                          )
                                                        : undefined
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
                                            行がありません。「期限を追加」で数えた在庫を入力してください。この状態で記録すると在庫は
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
                                                    <TableHead>
                                                        実在庫
                                                    </TableHead>
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
                                                        formatExpiry={
                                                            formatExpiry
                                                        }
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
                    </CardContent>
                    <CardFooter className="justify-end">
                        {/* 現在のロットを読めていない状態では送信させない。
                            行が空の送信は「全ロットを 0 にする」指定になるため、
                            読み込み失敗と利用者の意図を取り違えてはならない */}
                        <Button
                            disabled={
                                saving ||
                                loading ||
                                lotsLoading ||
                                lotsError !== null ||
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
                    </CardFooter>
                </form>
            </Card>

            {selectedItem ? (
                <Card>
                    <CardHeader>
                        <CardTitle>確定内容</CardTitle>
                        <CardDescription>
                            送信するとロットの数量がこの絶対値へ確定します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <output aria-live="polite" className="block">
                            {!built.ok ? (
                                <p className="text-sm text-muted-foreground">
                                    入力を修正すると確定内容を表示します。
                                </p>
                            ) : plan.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    変更はありません。
                                </p>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>期限</TableHead>
                                            <TableHead className="text-right">
                                                確定後
                                            </TableHead>
                                            <TableHead className="text-right">
                                                差分
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {plan.map((entry) => (
                                            <TableRow
                                                key={entry.expiryDate ?? "none"}
                                            >
                                                <TableCell>
                                                    {formatExpiry(
                                                        entry.expiryDate,
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {entry.quantity} {baseUnit}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {formatDelta(entry.delta)}{" "}
                                                    {baseUnit}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </output>
                    </CardContent>
                </Card>
            ) : null}

            {submitError ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {submitError} 内容を変えずに、もう一度送信できます。
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

const formatExpiry = (value: string | null): string => {
    if (!value) return "期限なし";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "期限なし"
        : dateFormatter.format(date);
};

const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
