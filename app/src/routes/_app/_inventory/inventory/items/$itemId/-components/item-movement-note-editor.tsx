import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { StockMovementDto } from "@/domain/stock";
import { itemStockHistoryKeys } from "../-api/item-detail-queries";
import { correctMovementNote } from "../-api/item-stock-api";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

/** movement id を固定してメモだけを訂正し、数量操作を再送しない。 */
export function ItemMovementNoteEditor({
    movement,
}: {
    movement: StockMovementDto;
}) {
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [note, setNote] = useState(movement.note ?? "");
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const mutation = useMutation({
        mutationFn: (nextNote: string | null) =>
            correctMovementNote(movement.id, nextNote),
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: itemStockHistoryKeys.all,
            }),
    });
    const saving = mutation.isPending;

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitError(null);
        setNotice(null);
        const normalizedNote = note.trim() || null;
        try {
            const corrected = await mutation.mutateAsync(normalizedNote);
            setNote(corrected.note ?? "");
            setEditing(false);
            setNotice(
                "メモを訂正しました。訂正前後の値を監査履歴へ保存しました。",
            );
        } catch (cause) {
            setSubmitError(errorMessage(cause, "メモを訂正できませんでした"));
        }
    };

    if (!editing) {
        return (
            <div className="flex flex-col items-end gap-2">
                <Button
                    aria-label={`${movement.id} のメモを訂正`}
                    onClick={() => {
                        setNote(movement.note ?? "");
                        setSubmitError(null);
                        setNotice(null);
                        setEditing(true);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    メモを訂正
                </Button>
                {notice ? (
                    <output
                        aria-live="polite"
                        className="max-w-64 text-xs text-muted-foreground"
                    >
                        {notice}
                    </output>
                ) : null}
            </div>
        );
    }

    return (
        <form className="flex min-w-64 flex-col gap-3" onSubmit={submit}>
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`movement-note-${movement.id}`}>
                        訂正後のメモ
                    </FieldLabel>
                    <Textarea
                        disabled={saving}
                        id={`movement-note-${movement.id}`}
                        maxLength={500}
                        onChange={(event) => {
                            setNote(event.target.value);
                            setSubmitError(null);
                        }}
                        value={note}
                    />
                    <FieldDescription>
                        空欄で保存するとメモを削除します。数量とロット配分は変わりません。
                    </FieldDescription>
                </Field>
            </FieldGroup>
            <div className="flex justify-end gap-2">
                <Button
                    disabled={saving}
                    onClick={() => {
                        setEditing(false);
                        setNote(movement.note ?? "");
                        setSubmitError(null);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    キャンセル
                </Button>
                <Button disabled={saving} size="sm" type="submit">
                    {saving ? "保存中…" : "訂正を保存"}
                </Button>
            </div>
            {submitError ? (
                <div
                    aria-live="assertive"
                    className="text-sm text-destructive"
                    role="alert"
                >
                    {submitError}
                </div>
            ) : null}
        </form>
    );
}
