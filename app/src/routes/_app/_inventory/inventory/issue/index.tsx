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
    allocateFefo,
    earliestExpiryDate,
    type ItemLotDto,
} from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { issueStock, listItemLots, listItems } from "./-api/stock-api";
import {
    type IssuePlan,
    parsePositiveInteger,
    planLotIssue,
    toIssuePlan,
} from "./-functions/issue-plan";

export const Route = createFileRoute("/_app/_inventory/inventory/issue/")({
    staticData: {
        breadcrumbs: [{ label: "出庫" }],
    },
    component: IssueStockPage,
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
});

// 出庫の理由は減少側のものだけを出す（購入は入庫画面、棚卸しは棚卸画面で扱う）
const reasonOptions: { label: string; value: StockMovementReason }[] = [
    { label: "消費", value: "consume" },
    { label: "廃棄", value: "discard" },
    { label: "その他", value: "other" },
];

type IssueMode = "fefo" | "lot";

const modeOptions: { label: string; value: IssueMode }[] = [
    { label: "期限が早いロットから自動で引く（FEFO）", value: "fefo" },
    { label: "ロットを指定して出庫", value: "lot" },
];

const emptyPlan: IssuePlan = { status: "ready", rows: [] };

function IssueStockPage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [selectedItemId, setSelectedItemId] = useState("");
    const [lots, setLots] = useState<ItemLotDto[]>([]);
    const [quantity, setQuantity] = useState("");
    const [mode, setMode] = useState<IssueMode>("fefo");
    const [selectedLotId, setSelectedLotId] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("consume");
    const [loading, setLoading] = useState(true);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [lotsError, setLotsError] = useState<string | null>(null);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [lotError, setLotError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [recorded, setRecorded] = useState<IssuePlan["rows"]>([]);
    // 送信内容が同じ限り同じ idempotency key で再送し、二重の出庫を防ぐ
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

    // 出庫で消えたロットは選択肢から外れるため、選択を持ち越さない
    useEffect(() => {
        setSelectedLotId((current) =>
            current && lots.some((lot) => lot.id === current) ? current : "",
        );
    }, [lots]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const parsedQuantity = useMemo(
        () => parsePositiveInteger(quantity),
        [quantity],
    );
    const plan = useMemo<IssuePlan>(() => {
        if (parsedQuantity === null) {
            return emptyPlan;
        }
        if (mode === "lot") {
            return planLotIssue(
                lots.find((lot) => lot.id === selectedLotId) ?? null,
                parsedQuantity,
            );
        }
        const allocation = allocateFefo(lots, parsedQuantity);
        return toIssuePlan(allocation.allocations, allocation.shortage);
    }, [lots, mode, parsedQuantity, selectedLotId]);

    const resetFeedback = () => {
        setSelectionError(null);
        setQuantityError(null);
        setLotError(null);
        setSubmitError(null);
        setNotice(null);
        setRecorded([]);
        pendingKey.current = null;
    };

    const handleItemChange = (value: string | null) => {
        setSelectedItemId(value ?? "");
        setSelectedLotId("");
        resetFeedback();
    };

    const handleQuantityChange = (value: string) => {
        setQuantity(value);
        resetFeedback();
    };

    const handleModeChange = (value: string | null) => {
        setMode(value === "lot" ? "lot" : "fefo");
        resetFeedback();
    };

    const handleLotChange = (value: string | null) => {
        setSelectedLotId(value ?? "");
        resetFeedback();
    };

    const handleReasonChange = (value: string | null) => {
        const next = reasonOptions.find((option) => option.value === value);
        if (next) setReason(next.value);
        resetFeedback();
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSelectionError(null);
        setQuantityError(null);
        setLotError(null);
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
        if (mode === "lot" && !selectedLotId) {
            setLotError("出庫するロットを選択してください");
            return;
        }
        if (plan.status === "shortage") {
            setQuantityError(
                `在庫が ${plan.shortage} ${selectedItem.baseUnit} 不足しています`,
            );
            return;
        }

        const lotId = mode === "lot" ? selectedLotId : null;
        const signature = JSON.stringify({
            itemId: selectedItem.id,
            quantity: parsedQuantity,
            lotId,
            reason,
        });
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };
        setSaving(true);
        try {
            const result = await issueStock(selectedItem.id, {
                quantity: parsedQuantity,
                lotId,
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
            // プレビューは送信前の在庫に基づくため、記録された内訳はサーバーの応答で置き換える
            setRecorded(result.allocations);
            setQuantity("");
            pendingKey.current = null;
            setNotice(
                result.replayed
                    ? "この出庫は既に記録済みです。保存済みの内訳を表示しました（再送）。"
                    : "出庫を記録しました。",
            );
        } catch (cause) {
            setSubmitError(errorMessage(cause, "出庫を記録できませんでした"));
        } finally {
            setSaving(false);
        }
    };

    const itemOptions = items.map((item) => ({
        label: item.name,
        value: item.id,
    }));
    const baseUnit = selectedItem?.baseUnit ?? "—";
    const lotOptions = lots.map((lot) => ({
        label: `${formatExpiry(lot.expiryDate)}（残り ${lot.quantity} ${baseUnit}）`,
        value: lot.id,
    }));
    const shortage = plan.status === "shortage" ? plan.shortage : 0;

    return (
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold">出庫</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    消費・廃棄した数量を、期限が早いロットから順に減らします。
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
                    <CardTitle>出庫を記録</CardTitle>
                    <CardDescription>
                        既定では期限が早いロットから自動で引きます。ロットを指定して引くこともできます。
                    </CardDescription>
                </CardHeader>
                <form onSubmit={submit}>
                    <CardContent>
                        <FieldGroup>
                            <Field data-invalid={Boolean(selectionError)}>
                                <FieldLabel htmlFor="issue-item">
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
                                                ? "issue-item-error"
                                                : undefined
                                        }
                                        aria-invalid={Boolean(selectionError)}
                                        className="w-full"
                                        id="issue-item"
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
                                    <FieldError id="issue-item-error">
                                        {selectionError}
                                    </FieldError>
                                ) : null}
                            </Field>

                            <Field data-invalid={Boolean(quantityError)}>
                                <FieldLabel htmlFor="issue-quantity">
                                    出庫数量
                                </FieldLabel>
                                <Input
                                    aria-describedby={
                                        quantityError
                                            ? "issue-quantity-description issue-quantity-error"
                                            : "issue-quantity-description"
                                    }
                                    aria-invalid={Boolean(quantityError)}
                                    disabled={!selectedItem || saving}
                                    id="issue-quantity"
                                    inputMode="numeric"
                                    min={1}
                                    onChange={(event) =>
                                        handleQuantityChange(event.target.value)
                                    }
                                    step={1}
                                    type="number"
                                    value={quantity}
                                />
                                <FieldDescription id="issue-quantity-description">
                                    1以上の整数を、品目の基準単位（{baseUnit}
                                    ）で入力します。現在庫は{" "}
                                    {selectedItem?.currentQuantity ?? 0}{" "}
                                    {baseUnit} です。
                                </FieldDescription>
                                {quantityError ? (
                                    <FieldError id="issue-quantity-error">
                                        {quantityError}
                                    </FieldError>
                                ) : null}
                            </Field>

                            <Field>
                                <FieldLabel htmlFor="issue-mode">
                                    引き当て方法
                                </FieldLabel>
                                <Select
                                    disabled={!selectedItem || saving}
                                    items={modeOptions}
                                    onValueChange={handleModeChange}
                                    value={mode}
                                >
                                    <SelectTrigger
                                        aria-describedby="issue-mode-description"
                                        className="w-full"
                                        id="issue-mode"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {modeOptions.map((option) => (
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
                                <FieldDescription id="issue-mode-description">
                                    FEFO
                                    は期限が早いロットから順に引きます。期限なしのロットは最後に引きます。
                                </FieldDescription>
                            </Field>

                            {mode === "lot" ? (
                                <Field data-invalid={Boolean(lotError)}>
                                    <FieldLabel htmlFor="issue-lot">
                                        出庫するロット
                                    </FieldLabel>
                                    <Select
                                        disabled={
                                            !selectedItem ||
                                            saving ||
                                            lotOptions.length === 0
                                        }
                                        items={lotOptions}
                                        onValueChange={handleLotChange}
                                        value={selectedLotId || null}
                                    >
                                        <SelectTrigger
                                            aria-describedby={
                                                lotError
                                                    ? "issue-lot-error"
                                                    : undefined
                                            }
                                            aria-invalid={Boolean(lotError)}
                                            className="w-full"
                                            id="issue-lot"
                                        >
                                            <SelectValue
                                                placeholder={
                                                    lotsLoading
                                                        ? "ロットを読み込み中…"
                                                        : lotOptions.length ===
                                                            0
                                                          ? "在庫のあるロットがありません"
                                                          : "ロットを選択"
                                                }
                                            />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {lotOptions.map((option) => (
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
                                    {lotError ? (
                                        <FieldError id="issue-lot-error">
                                            {lotError}
                                        </FieldError>
                                    ) : null}
                                </Field>
                            ) : null}

                            <Field>
                                <FieldLabel htmlFor="issue-reason">
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
                                        id="issue-reason"
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
                            disabled={
                                saving ||
                                loading ||
                                !selectedItem ||
                                plan.status === "shortage"
                            }
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "出庫を再送"
                                  : "出庫を記録"}
                        </Button>
                    </CardFooter>
                </form>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>引き当てプレビュー</CardTitle>
                    <CardDescription>
                        送信するとこの内訳でロットの数量が減ります。
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
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
                                        ? void loadLots(selectedItemId)
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
                    <output aria-live="polite" className="flex flex-col gap-3">
                        {!selectedItem ? (
                            <p className="text-sm text-muted-foreground">
                                品目を選ぶと、引き当てられるロットを表示します。
                            </p>
                        ) : lotsLoading ? (
                            <p className="text-sm text-muted-foreground">
                                ロットを読み込み中…
                            </p>
                        ) : lots.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                在庫のあるロットがありません。先に入庫を記録してください。
                            </p>
                        ) : plan.rows.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                数量を入力すると、引き当てるロットを表示します。
                            </p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>期限</TableHead>
                                        <TableHead className="text-right">
                                            引き当て
                                        </TableHead>
                                        <TableHead className="text-right">
                                            出庫後の残り
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {plan.rows.map((row) => (
                                        <TableRow key={row.lotId}>
                                            <TableCell>
                                                {formatExpiry(row.expiryDate)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {row.delta} {baseUnit}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {remainingQuantity(
                                                    lots,
                                                    row.lotId,
                                                    row.delta,
                                                )}{" "}
                                                {baseUnit}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                        {shortage > 0 ? (
                            <p className="text-sm font-medium text-destructive">
                                在庫が {shortage} {baseUnit}{" "}
                                不足しています。数量またはロットを見直してください。
                            </p>
                        ) : null}
                    </output>
                </CardContent>
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
                    {recorded.length > 0 ? (
                        <ul className="flex flex-col gap-1 text-muted-foreground">
                            {recorded.map((allocation) => (
                                <li key={allocation.lotId}>
                                    {formatExpiry(allocation.expiryDate)}:{" "}
                                    {allocation.delta} {baseUnit}
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

const formatExpiry = (value: string | null): string => {
    if (!value) return "期限なし";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "期限なし"
        : dateFormatter.format(date);
};

const remainingQuantity = (
    lots: readonly ItemLotDto[],
    lotId: string,
    delta: number,
): number => {
    const lot = lots.find((candidate) => candidate.id === lotId);
    return lot ? lot.quantity + delta : 0;
};
