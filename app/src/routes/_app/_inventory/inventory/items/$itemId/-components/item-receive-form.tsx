import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { ItemDetailDto } from "@/domain/item";
import type { LotAllocationDto } from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
import {
    parsePositiveInteger,
    toDateTimeLocalValue,
    toIsoDateTime,
} from "@/lib/expiry-input";
import {
    inventoryKeys,
    itemKeys,
    itemStockHistoryKeys,
} from "../-api/item-detail-queries";
import { type ReceiveStockInput, receiveStock } from "../-api/item-stock-api";

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

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatDelta = (delta: number): string =>
    `${delta > 0 ? "+" : ""}${delta.toLocaleString("ja-JP")}`;

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";

/**
 * この品目へ在庫を足すフォーム。入庫画面と同じ調整エンドポイントを呼び、
 * 同じ内容の再送では同じ冪等キーを使って二重計上を防ぐ。
 * 期限は既存ロットの期限を選ぶと入力欄へ写す。
 */
export function ItemReceiveForm({ item }: { item: ItemDetailDto }) {
    const queryClient = useQueryClient();
    const [quantity, setQuantity] = useState("");
    const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
    const [expiryInput, setExpiryInput] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("purchase");
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [expiryError, setExpiryError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<LotAllocationDto[]>([]);
    // 送信内容が同じ限り同じ idempotency key で再送し、二重計上を防ぐ
    const pendingKey = useRef<{ signature: string; value: string } | null>(
        null,
    );

    // 入庫はこの品目の在庫数・ロット・履歴と、一覧側の数量を同時に変える。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ
    const receiveMutation = useMutation({
        mutationFn: (input: ReceiveStockInput) => receiveStock(item.id, input),
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: itemStockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
            ]),
    });
    const saving = receiveMutation.isPending;

    const parsedQuantity = useMemo(
        () => parsePositiveInteger(quantity),
        [quantity],
    );
    const expiryDate = useMemo(
        () => (expiryMode === "none" ? null : toIsoDateTime(expiryInput)),
        [expiryInput, expiryMode],
    );

    const resetFeedback = () => {
        setQuantityError(null);
        setExpiryError(null);
        setSubmitError(null);
        setNotice(null);
        setAllocations([]);
        pendingKey.current = null;
    };

    const applyExistingLot = (lotExpiryDate: string | null) => {
        if (lotExpiryDate === null) {
            setExpiryMode("none");
            setExpiryInput("");
        } else {
            setExpiryMode("date");
            setExpiryInput(toDateTimeLocalValue(lotExpiryDate));
        }
        resetFeedback();
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setQuantityError(null);
        setExpiryError(null);
        setSubmitError(null);
        setNotice(null);

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
            itemId: item.id,
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

    return (
        <form className="flex flex-col gap-5" onSubmit={submit}>
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
                <Field data-invalid={Boolean(quantityError)}>
                    <FieldLabel htmlFor="item-receive-quantity">
                        入庫数量（{item.baseUnit}）
                    </FieldLabel>
                    <Input
                        aria-describedby={
                            quantityError
                                ? "item-receive-quantity-error"
                                : undefined
                        }
                        aria-invalid={Boolean(quantityError)}
                        disabled={saving}
                        id="item-receive-quantity"
                        inputMode="numeric"
                        min={1}
                        onChange={(event) => {
                            setQuantity(event.target.value);
                            resetFeedback();
                        }}
                        step={1}
                        type="number"
                        value={quantity}
                    />
                    {quantityError ? (
                        <FieldError id="item-receive-quantity-error">
                            {quantityError}
                        </FieldError>
                    ) : null}
                </Field>

                <Field>
                    <FieldLabel htmlFor="item-receive-reason">理由</FieldLabel>
                    <Select
                        disabled={saving}
                        items={reasonOptions}
                        onValueChange={(value) => {
                            const next = reasonOptions.find(
                                (option) => option.value === value,
                            );
                            if (next) setReason(next.value);
                            resetFeedback();
                        }}
                        value={reason}
                    >
                        <SelectTrigger
                            className="w-full"
                            id="item-receive-reason"
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

                <Field>
                    <FieldLabel htmlFor="item-receive-expiry-mode">
                        期限の扱い
                    </FieldLabel>
                    <Select
                        disabled={saving}
                        items={expiryModeOptions}
                        onValueChange={(value) => {
                            setExpiryMode(value === "none" ? "none" : "date");
                            resetFeedback();
                        }}
                        value={expiryMode}
                    >
                        <SelectTrigger
                            className="w-full"
                            id="item-receive-expiry-mode"
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
                        <FieldLabel htmlFor="item-receive-expiry-date">
                            期限日時
                        </FieldLabel>
                        <Input
                            aria-describedby={
                                expiryError
                                    ? "item-receive-expiry-error"
                                    : undefined
                            }
                            aria-invalid={Boolean(expiryError)}
                            disabled={saving}
                            id="item-receive-expiry-date"
                            onChange={(event) => {
                                setExpiryInput(event.target.value);
                                setExpiryMode("date");
                                resetFeedback();
                            }}
                            type="datetime-local"
                            value={expiryInput}
                        />
                        {expiryError ? (
                            <FieldError id="item-receive-expiry-error">
                                {expiryError}
                            </FieldError>
                        ) : null}
                    </Field>
                ) : null}
            </FieldGroup>

            {item.lots.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                        既存のロットへ足す:
                    </span>
                    {item.lots.map((lot) => (
                        <Button
                            key={lot.id}
                            onClick={() => applyExistingLot(lot.expiryDate)}
                            size="xs"
                            type="button"
                            variant="outline"
                        >
                            {formatExpiry(lot.expiryDate)}
                        </Button>
                    ))}
                </div>
            ) : null}

            <div className="flex justify-end">
                <Button disabled={saving} type="submit">
                    {saving
                        ? "送信中…"
                        : submitError
                          ? "入庫を再送"
                          : "入庫を記録"}
                </Button>
            </div>

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
                                    {formatDelta(allocation.delta)}{" "}
                                    {item.baseUnit}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </output>
            ) : null}
        </form>
    );
}
