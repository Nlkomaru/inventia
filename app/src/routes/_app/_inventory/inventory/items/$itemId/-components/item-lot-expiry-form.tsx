import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import type { ItemLotDto } from "@/domain/lot";
import { toDateInputValue, toIsoFromDate } from "@/lib/expiry-input";
import {
    inventoryKeys,
    itemKeys,
    itemStockHistoryKeys,
} from "../-api/item-detail-queries";
import { updateLotExpiry } from "../-api/item-stock-api";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

/**
 * 既にあるロットの期限を直す。数量は動かさないため在庫履歴は増えず、
 * 過去の払い出し履歴が持つ期限のスナップショットも書き換わらない。
 * 同じ品目に同じ期限のロットは作れないため、重複は API の 409 をそのまま見せる。
 */
export function ItemLotExpiryForm({
    itemId,
    lot,
    onClose,
}: {
    itemId: string;
    lot: ItemLotDto;
    onClose: () => void;
}) {
    const queryClient = useQueryClient();
    const [expiryInput, setExpiryInput] = useState(() =>
        toDateInputValue(lot.expiryDate),
    );
    const [error, setError] = useState<string | null>(null);

    // 期限はロット一覧・最短期限・在庫一覧の並びに効くため、まとめて無効化する。
    // 履歴は期限のスナップショットを持つので変わらないが、表示元が同じ品目なので揃える
    const mutation = useMutation({
        mutationFn: (expiryDate: string | null) =>
            updateLotExpiry(itemId, lot.id, expiryDate),
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: itemStockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
            ]),
    });

    const submit = async (expiryDate: string | null) => {
        setError(null);
        try {
            await mutation.mutateAsync(expiryDate);
            onClose();
        } catch (cause) {
            setError(errorMessage(cause, "期限を変更できませんでした"));
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <Field>
                <FieldLabel htmlFor={`lot-expiry-${lot.id}`}>
                    新しい期限
                </FieldLabel>
                <DatePicker
                    id={`lot-expiry-${lot.id}`}
                    onValueChange={setExpiryInput}
                    value={expiryInput}
                />
                <FieldError>{error}</FieldError>
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button
                    disabled={mutation.isPending || expiryInput === ""}
                    onClick={() => {
                        const iso = toIsoFromDate(expiryInput);
                        if (iso === null) {
                            setError("日付を正しく入力してください");
                            return;
                        }
                        void submit(iso);
                    }}
                    size="sm"
                    type="button"
                >
                    {mutation.isPending ? "保存中…" : "期限を変更"}
                </Button>
                <Button
                    disabled={mutation.isPending || lot.expiryDate === null}
                    onClick={() => void submit(null)}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    期限なしにする
                </Button>
                <Button
                    disabled={mutation.isPending}
                    onClick={onClose}
                    size="sm"
                    type="button"
                    variant="ghost"
                >
                    取消
                </Button>
            </div>
        </div>
    );
}
