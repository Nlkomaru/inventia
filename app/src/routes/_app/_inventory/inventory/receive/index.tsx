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
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Field,
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
import type { ItemLotDto, LotAllocationDto } from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
import { type ReceiveStockInput, receiveStock } from "./-api/stock-api";
import {
    inventoryKeys,
    itemKeys,
    itemListQueryOptions,
    itemLotsQueryOptions,
    stockHistoryKeys,
} from "./-api/stock-queries";
import {
    parsePositiveInteger,
    toDateTimeLocalValue,
    toIsoDateTime,
} from "./-functions/expiry-input";

export const Route = createFileRoute("/_app/_inventory/inventory/receive/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(itemListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "入庫" }],
    },
    component: ReceiveStockPage,
    pendingComponent: ReceivePending,
    errorComponent: ReceiveError,
});

const pageClassName = "mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8";

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

// 未取得時の既定値は参照を固定する。毎描画で新しい配列を作ると
// ロットに依存する derive が無限に走る
const noLots: ItemLotDto[] = [];

type ReceiveSubmitInput = ReceiveStockInput & { itemId: string };

function ReceiveStockPage() {
    const queryClient = useQueryClient();
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const [selectedItemId, setSelectedItemId] = useState("");
    const lotsQuery = useQuery(itemLotsQueryOptions(selectedItemId));
    const lots = lotsQuery.data ?? noLots;
    const [quantity, setQuantity] = useState("");
    const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
    const [expiryInput, setExpiryInput] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("purchase");
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

    // 入庫はロット構成・品目の在庫数・在庫履歴を同時に変えるため、関係する query をまとめて無効化する。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const receiveMutation = useMutation({
        mutationFn: ({ itemId, ...input }: ReceiveSubmitInput) =>
            receiveStock(itemId, input),
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
    const saving = receiveMutation.isPending;
    const lotsLoading = lotsQuery.isLoading;
    const lotsError = lotsQuery.error
        ? errorMessage(lotsQuery.error, "ロットを読み込めませんでした")
        : null;

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
        try {
            const result = await receiveMutation.mutateAsync({
                itemId: selectedItem.id,
                quantity: parsedQuantity,
                expiryDate,
                reason,
                idempotencyKey,
            });
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
                <h1 className="mt-1 text-2xl font-bold">入庫</h1>
            </header>

            <section aria-labelledby="receive-form-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 className="font-bold" id="receive-form-title">
                        入庫を記録
                    </h2>
                </div>
                <form
                    className="flex max-w-2xl flex-col gap-5"
                    onSubmit={submit}
                >
                    <FieldGroup>
                        <Field data-invalid={Boolean(selectionError)}>
                            <FieldLabel htmlFor="receive-item">品目</FieldLabel>
                            <Select
                                disabled={items.length === 0}
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
                                <FieldError id="receive-item-error">
                                    {selectionError}
                                </FieldError>
                            ) : null}
                        </Field>

                        <Field data-invalid={Boolean(quantityError)}>
                            <FieldLabel htmlFor="receive-quantity">
                                入庫数量{selectedItem ? `（${baseUnit}）` : ""}
                            </FieldLabel>
                            <Input
                                aria-describedby={
                                    quantityError
                                        ? "receive-quantity-error"
                                        : undefined
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
                        </Field>

                        {expiryMode === "date" ? (
                            <Field data-invalid={Boolean(expiryError)}>
                                <FieldLabel htmlFor="receive-expiry-date">
                                    期限日時
                                </FieldLabel>
                                <Input
                                    aria-describedby={
                                        expiryError
                                            ? "receive-expiry-error"
                                            : undefined
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
                    <div className="flex justify-end gap-2">
                        <Button
                            disabled={saving || !selectedItem}
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "入庫を再送"
                                  : "入庫を記録"}
                        </Button>
                    </div>
                </form>
            </section>

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

            {selectedItem ? (
                <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                    <div className="border-b p-5">
                        <h2 className="font-bold">現在のロット</h2>
                        <p className="text-xs text-muted-foreground">
                            {selectedItem.name}の在庫は合計{" "}
                            {selectedItem.currentQuantity} {baseUnit} です。
                        </p>
                    </div>
                    {lotsError ? (
                        <div className="p-5">
                            <div
                                aria-live="polite"
                                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                                role="alert"
                            >
                                <span>{lotsError}</span>
                                <Button
                                    onClick={() => void lotsQuery.refetch()}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                >
                                    再読み込み
                                </Button>
                            </div>
                        </div>
                    ) : lotsLoading ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            ロットを読み込み中…
                        </p>
                    ) : lots.length === 0 ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            在庫のあるロットはありません。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="px-5">期限</TableHead>
                                    <TableHead className="px-5 text-right">
                                        数量
                                    </TableHead>
                                    <TableHead className="px-5 text-right">
                                        操作
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {lots.map((lot) => (
                                    <TableRow key={lot.id}>
                                        <TableCell className="px-5 py-3">
                                            {formatExpiry(lot.expiryDate)}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 text-right">
                                            {lot.quantity} {baseUnit}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 text-right">
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
                </section>
            ) : null}
        </main>
    );
}

function ReceivePending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function ReceiveError({ error, reset }: ErrorComponentProps) {
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

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";

const formatDelta = (delta: number): string =>
    delta > 0 ? `+${delta}` : String(delta);
