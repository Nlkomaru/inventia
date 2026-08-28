import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import type { ItemDetailDto } from "@/domain/item";
import { allocateFefo, type LotAllocationDto } from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
import { parsePositiveInteger } from "@/lib/expiry-input";
import {
    inventoryKeys,
    itemKeys,
    itemStockHistoryKeys,
} from "../-api/item-detail-queries";
import { type IssueStockInput, issueStock } from "../-api/item-stock-api";

const reasonOptions: { label: string; value: StockMovementReason }[] = [
    { label: "消費", value: "consume" },
    { label: "廃棄", value: "discard" },
    { label: "その他", value: "other" },
];

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";

/** 個別在庫から FEFO で出庫し、共通の調整 API の冪等性を維持するフォーム。 */
export function ItemIssueForm({ item }: { item: ItemDetailDto }) {
    const queryClient = useQueryClient();
    const [quantity, setQuantity] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("consume");
    const [note, setNote] = useState("");
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<LotAllocationDto[]>([]);
    const pendingKey = useRef<{ signature: string; value: string } | null>(
        null,
    );

    const issueMutation = useMutation({
        mutationFn: (input: IssueStockInput) => issueStock(item.id, input),
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: itemStockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
            ]),
    });
    const saving = issueMutation.isPending;
    const parsedQuantity = useMemo(
        () => parsePositiveInteger(quantity),
        [quantity],
    );
    const preview = useMemo(
        () =>
            parsedQuantity === null
                ? { allocations: [], shortage: 0 }
                : allocateFefo(item.lots, parsedQuantity),
        [item.lots, parsedQuantity],
    );

    const resetFeedback = () => {
        setQuantityError(null);
        setSubmitError(null);
        setNotice(null);
        setAllocations([]);
        pendingKey.current = null;
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setQuantityError(null);
        setSubmitError(null);
        setNotice(null);

        if (parsedQuantity === null) {
            setQuantityError("1以上の整数で入力してください");
            return;
        }
        if (parsedQuantity > item.currentQuantity) {
            setQuantityError(
                `現在庫 ${item.currentQuantity.toLocaleString("ja-JP")} ${item.baseUnit} 以下で入力してください`,
            );
            return;
        }

        const normalizedNote = note.trim();
        const signature = JSON.stringify({
            itemId: item.id,
            quantity: parsedQuantity,
            reason,
            note: normalizedNote || null,
        });
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };

        try {
            const result = await issueMutation.mutateAsync({
                quantity: parsedQuantity,
                reason,
                ...(normalizedNote ? { note: normalizedNote } : {}),
                idempotencyKey,
            });
            setAllocations(result.allocations);
            setQuantity("");
            setNote("");
            pendingKey.current = null;
            setNotice(
                result.replayed
                    ? "この出庫は既に記録済みです。保存済みの内訳を表示しました（再送）。"
                    : "出庫を記録しました。",
            );
        } catch (cause) {
            setSubmitError(errorMessage(cause, "出庫を記録できませんでした"));
        }
    };

    const shownAllocations =
        allocations.length > 0 ? allocations : preview.allocations;

    return (
        <form className="flex flex-col gap-5" onSubmit={submit}>
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
                <Field data-invalid={Boolean(quantityError)}>
                    <FieldLabel htmlFor="item-issue-quantity">
                        出庫数量（{item.baseUnit}）
                    </FieldLabel>
                    <Input
                        aria-describedby={
                            quantityError
                                ? "item-issue-quantity-error"
                                : undefined
                        }
                        aria-invalid={Boolean(quantityError)}
                        disabled={saving || item.currentQuantity === 0}
                        id="item-issue-quantity"
                        inputMode="numeric"
                        max={item.currentQuantity}
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
                        <FieldError id="item-issue-quantity-error">
                            {quantityError}
                        </FieldError>
                    ) : (
                        <FieldDescription>
                            現在庫:{" "}
                            {item.currentQuantity.toLocaleString("ja-JP")}{" "}
                            {item.baseUnit}
                        </FieldDescription>
                    )}
                </Field>

                <Field>
                    <FieldLabel htmlFor="item-issue-reason">理由</FieldLabel>
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
                            id="item-issue-reason"
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

                <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="item-issue-note">
                        メモ（任意）
                    </FieldLabel>
                    <Textarea
                        disabled={saving}
                        id="item-issue-note"
                        maxLength={500}
                        onChange={(event) => {
                            setNote(event.target.value);
                            resetFeedback();
                        }}
                        placeholder="例: 青椒肉絲（2026-08-27 夕食）"
                        value={note}
                    />
                    <FieldDescription>
                        何に使用したかを500文字以内で記録できます。
                    </FieldDescription>
                </Field>
            </FieldGroup>

            {shownAllocations.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                    <span className="font-medium">
                        {allocations.length > 0
                            ? "記録したロット内訳"
                            : "FEFO 配分予定"}
                    </span>
                    <ul className="flex flex-col gap-1 text-muted-foreground">
                        {shownAllocations.map((allocation) => (
                            <li key={allocation.lotId}>
                                {formatExpiry(allocation.expiryDate)}:{" "}
                                {Math.abs(allocation.delta).toLocaleString(
                                    "ja-JP",
                                )}{" "}
                                {item.baseUnit}
                            </li>
                        ))}
                    </ul>
                    {preview.shortage > 0 && allocations.length === 0 ? (
                        <span className="text-destructive">
                            在庫が {preview.shortage.toLocaleString("ja-JP")}{" "}
                            {item.baseUnit} 不足します。
                        </span>
                    ) : null}
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    期限の近いロットから自動で出庫します。期限なしロットは最後に使用します。
                </p>
            )}

            <div className="flex justify-end">
                <Button
                    disabled={saving || item.currentQuantity === 0}
                    type="submit"
                >
                    {saving
                        ? "送信中…"
                        : submitError
                          ? "出庫を再送"
                          : "出庫を記録"}
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
                    className="rounded-lg border bg-muted/50 p-3 text-sm"
                >
                    {notice}
                </output>
            ) : null}
        </form>
    );
}
