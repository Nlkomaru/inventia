import { createFileRoute } from "@tanstack/react-router";
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
import { Input } from "@/components/ui/input";
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
} from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { listItemLots, listItems, receiveStock } from "./-api/stock-api";
import {
    parsePositiveInteger,
    toDateTimeLocalValue,
    toIsoDateTime,
} from "./-functions/expiry-input";

export const Route = createFileRoute("/_app/_inventory/inventory/receive/")({
    staticData: {
        breadcrumbs: [{ label: "入庫" }],
    },
    component: ReceiveStockPage,
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
});

// 入庫の理由は増加側のものだけを出す（消費・廃棄は出庫画面、棚卸しは棚卸画面で扱う）
const reasonOptions: { label: string; value: StockMovementReason }[] = [
    { label: "購入", value: "purchase" },
    { label: "その他", value: "other" },
];

type ExpiryMode = "date" | "none";

const expiryModeOptions: { label: string; value: ExpiryMode }[] = [
    { label: "期限を指定する", value: "date" },
    { label: "期限なし", value: "none" },
];

function ReceiveStockPage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [selectedItemId, setSelectedItemId] = useState("");
    const [lots, setLots] = useState<ItemLotDto[]>([]);
    const [quantity, setQuantity] = useState("");
    const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
    const [expiryInput, setExpiryInput] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("purchase");
    const [loading, setLoading] = useState(true);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [lotsError, setLotsError] = useState<string | null>(null);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [expiryError, setExpiryError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<LotAllocationDto[]>([]);
    // 送信内容が同じ限り同じ idempotency key で再送し、二重計上を防ぐ
    const pendingKey = useRef<{ signature: string; value: string } | null>(
        null,
    );

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
            setLots(await listItemLots(itemId));
        } catch (cause) {
            setLots([]);
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
            setLotsError(null);
            return;
        }
        void loadLots(selectedItemId);
    }, [loadLots, selectedItemId]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const parsedQuantity = useMemo(
        () => parsePositiveInteger(quantity),
        [quantity],
    );
    const expiryDate = useMemo(
        () => (expiryMode === "none" ? null : toIsoDateTime(expiryInput)),
        [expiryInput, expiryMode],
    );

    const resetFeedback = () => {
        setSelectionError(null);
        setQuantityError(null);
        setExpiryError(null);
        setSubmitError(null);
        setNotice(null);
        setAllocations([]);
        pendingKey.current = null;
    };

    const handleItemChange = (value: string | null) => {
        setSelectedItemId(value ?? "");
        resetFeedback();
    };

    const handleQuantityChange = (value: string) => {
        setQuantity(value);
        resetFeedback();
    };

    const handleExpiryModeChange = (value: string | null) => {
        setExpiryMode(value === "none" ? "none" : "date");
        resetFeedback();
    };

    const handleExpiryInputChange = (value: string) => {
        setExpiryInput(value);
        setExpiryMode("date");
        resetFeedback();
    };

    const handleReasonChange = (value: string | null) => {
        const next = reasonOptions.find((option) => option.value === value);
        if (next) setReason(next.value);
        resetFeedback();
    };

    const applyExistingLot = (lot: ItemLotDto) => {
        if (lot.expiryDate === null) {
            setExpiryMode("none");
            setExpiryInput("");
        } else {
            setExpiryMode("date");
            setExpiryInput(toDateTimeLocalValue(lot.expiryDate));
        }
        resetFeedback();
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSelectionError(null);
        setQuantityError(null);
        setExpiryError(null);
        setSubmitError(null);
        setNotice(null);

        if (!selectedItem) {
            setSelectionError("品目を選択してください");
            return;
        }
        if (parsedQuantity === null) {
            setQuantityError("1以上の整数で入力してください");
            return;
        }
        if (expiryMode === "date" && expiryDate === null) {
            setExpiryError(
                "期限日時を入力するか、「期限なし」を選択してください",
            );
            return;
        }

        const signature = JSON.stringify({
            itemId: selectedItem.id,
            quantity: parsedQuantity,
            expiryDate,
            reason,
        });
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };
        setSaving(true);
        try {
            const result = await receiveStock(selectedItem.id, {
                quantity: parsedQuantity,
                expiryDate,
                reason,
                idempotencyKey,
            });
            setLots(result.lots);
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
            setQuantity("");
            pendingKey.current = null;
            setNotice(
                result.replayed
                    ? "この入庫は既に記録済みです。保存済みの内訳を表示しました（再送）。"
                    : "入庫を記録しました。",
            );
        } catch (cause) {
            setSubmitError(errorMessage(cause, "入庫を記録できませんでした"));
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
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold">入庫</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    購入・補充した数量を、期限ごとのロットへ加算します。
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
                    <CardTitle>入庫を記録</CardTitle>
                    <CardDescription>
                        同じ期限のロットがあれば数量を加算し、なければロットを新しく作ります。
                    </CardDescription>
                </CardHeader>
                <form onSubmit={submit}>
                    <CardContent>
                        <FieldGroup>
                            <Field data-invalid={Boolean(selectionError)}>
                                <FieldLabel htmlFor="receive-item">
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
                                                ? "receive-item-error"
                                                : undefined
                                        }
                                        aria-invalid={Boolean(selectionError)}
                                        className="w-full"
                                        id="receive-item"
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
                                    <FieldError id="receive-item-error">
                                        {selectionError}
                                    </FieldError>
                                ) : null}
                            </Field>

                            <Field data-invalid={Boolean(quantityError)}>
                                <FieldLabel htmlFor="receive-quantity">
                                    入庫数量
                                </FieldLabel>
                                <Input
                                    aria-describedby={
                                        quantityError
                                            ? "receive-quantity-description receive-quantity-error"
                                            : "receive-quantity-description"
                                    }
                                    aria-invalid={Boolean(quantityError)}
                                    disabled={!selectedItem || saving}
                                    id="receive-quantity"
                                    inputMode="numeric"
                                    min={1}
                                    onChange={(event) =>
                                        handleQuantityChange(event.target.value)
                                    }
                                    step={1}
                                    type="number"
                                    value={quantity}
                                />
                                <FieldDescription id="receive-quantity-description">
                                    1以上の整数を、品目の基準単位（{baseUnit}
                                    ）で入力します。
                                </FieldDescription>
                                {quantityError ? (
                                    <FieldError id="receive-quantity-error">
                                        {quantityError}
                                    </FieldError>
                                ) : null}
                            </Field>

                            <Field>
                                <FieldLabel htmlFor="receive-expiry-mode">
                                    期限の扱い
                                </FieldLabel>
                                <Select
                                    disabled={!selectedItem || saving}
                                    items={expiryModeOptions}
                                    onValueChange={handleExpiryModeChange}
                                    value={expiryMode}
                                >
                                    <SelectTrigger
                                        aria-describedby="receive-expiry-mode-description"
                                        className="w-full"
                                        id="receive-expiry-mode"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {expiryModeOptions.map((option) => (
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
                                <FieldDescription id="receive-expiry-mode-description">
                                    「期限なし」を選ぶと、期限を持たないロットへ加算します。
                                </FieldDescription>
                            </Field>

                            {expiryMode === "date" ? (
                                <Field data-invalid={Boolean(expiryError)}>
                                    <FieldLabel htmlFor="receive-expiry-date">
                                        期限日時
                                    </FieldLabel>
                                    <Input
                                        aria-describedby={
                                            expiryError
                                                ? "receive-expiry-description receive-expiry-error"
                                                : "receive-expiry-description"
                                        }
                                        aria-invalid={Boolean(expiryError)}
                                        disabled={!selectedItem || saving}
                                        id="receive-expiry-date"
                                        onChange={(event) =>
                                            handleExpiryInputChange(
                                                event.target.value,
                                            )
                                        }
                                        type="datetime-local"
                                        value={expiryInput}
                                    />
                                    <FieldDescription id="receive-expiry-description">
                                        既存ロットと同じ期限を入力すると、そのロットへ合算されます。
                                    </FieldDescription>
                                    {expiryError ? (
                                        <FieldError id="receive-expiry-error">
                                            {expiryError}
                                        </FieldError>
                                    ) : null}
                                </Field>
                            ) : null}

                            <Field>
                                <FieldLabel htmlFor="receive-reason">
                                    理由
                                </FieldLabel>
                                <Select
                                    disabled={!selectedItem || saving}
                                    items={reasonOptions}
                                    onValueChange={handleReasonChange}
                                    value={reason}
                                >
                                    <SelectTrigger
                                        className="w-full"
                                        id="receive-reason"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {reasonOptions.map((option) => (
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
                        </FieldGroup>
                    </CardContent>
                    <CardFooter className="justify-end">
                        <Button
                            disabled={saving || loading || !selectedItem}
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "入庫を再送"
                                  : "入庫を記録"}
                        </Button>
                    </CardFooter>
                </form>
            </Card>

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

            {selectedItem ? (
                <Card>
                    <CardHeader>
                        <CardTitle>現在のロット</CardTitle>
                        <CardDescription>
                            {selectedItem.name}の在庫は合計{" "}
                            {selectedItem.currentQuantity} {baseUnit}{" "}
                            です。期限が早い順に表示します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {lotsError ? (
                            <div
                                aria-live="polite"
                                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                                role="alert"
                            >
                                <span>{lotsError}</span>
                                <Button
                                    onClick={() =>
                                        void loadLots(selectedItem.id)
                                    }
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                >
                                    再読み込み
                                </Button>
                            </div>
                        ) : lotsLoading ? (
                            <p className="text-sm text-muted-foreground">
                                ロットを読み込み中…
                            </p>
                        ) : lots.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                在庫のあるロットはありません。入庫すると最初のロットが作られます。
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>期限</TableHead>
                                        <TableHead className="text-right">
                                            数量
                                        </TableHead>
                                        <TableHead className="text-right">
                                            操作
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {lots.map((lot) => (
                                        <TableRow key={lot.id}>
                                            <TableCell>
                                                {formatExpiry(lot.expiryDate)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {lot.quantity} {baseUnit}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    onClick={() =>
                                                        applyExistingLot(lot)
                                                    }
                                                    size="sm"
                                                    type="button"
                                                    variant="outline"
                                                >
                                                    この期限に追加
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            ) : null}
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatExpiry = (value: string | null): string => {
    if (!value) return "期限なし";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "期限なし"
        : dateFormatter.format(date);
};

const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
