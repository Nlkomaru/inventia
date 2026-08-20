import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { itemEmojiSchema } from "@/domain/item";
import { inventoryKeys, itemKeys } from "../-api/item-detail-queries";
import { regenerateItemEmoji, setItemEmoji } from "../-api/item-emoji-api";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

/**
 * 品目の絵文字を直す。AI に作り直させる操作と手入力を同じ場所に置き、
 * 生成できなかったときにその場で入力へ切り替えられるようにする。
 */
export function ItemEmojiForm({
    itemId,
    emoji,
}: {
    itemId: string;
    emoji: string;
}) {
    const queryClient = useQueryClient();
    // 保存前の編集値だけを持ち、確定値は品目のクエリを唯一の情報源にする
    const [draft, setDraft] = useState<string | null>(null);
    const value = draft ?? emoji;
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const validation = itemEmojiSchema.safeParse(value);

    // 絵文字は一覧にも出るため、品目と在庫一覧をまとめて無効化する
    const invalidate = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: itemKeys.all }),
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
        ]);

    const regenerate = useMutation({
        mutationFn: () => regenerateItemEmoji(itemId),
        onSuccess: invalidate,
    });
    const save = useMutation({
        mutationFn: (next: string) => setItemEmoji(itemId, next),
        onSuccess: invalidate,
    });
    const pending = regenerate.isPending || save.isPending;

    const submit = async (
        action: () => Promise<unknown>,
        messages: { done: string; failed: string },
    ) => {
        setMessage(null);
        setError(null);
        try {
            await action();
            // 編集値を捨て、再取得した保存済みの絵文字を表示へ戻す
            setDraft(null);
            setMessage(messages.done);
        } catch (cause) {
            setError(errorMessage(cause, messages.failed));
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    aria-invalid={validation.success === false}
                    aria-label="絵文字"
                    className="w-16 text-center text-xl"
                    id="item-emoji"
                    onChange={(event) => setDraft(event.target.value)}
                    value={value}
                />
                <Button
                    disabled={pending || value === emoji || !validation.success}
                    onClick={() =>
                        void submit(() => save.mutateAsync(value), {
                            done: "絵文字を保存しました",
                            failed: "絵文字を保存できませんでした",
                        })
                    }
                    size="sm"
                    type="button"
                >
                    {save.isPending ? "保存中…" : "保存"}
                </Button>
                <Button
                    disabled={pending}
                    onClick={() =>
                        void submit(() => regenerate.mutateAsync(), {
                            done: "絵文字を作り直しました",
                            failed: "絵文字を生成できませんでした",
                        })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    {regenerate.isPending ? "生成中…" : "AI で作り直す"}
                </Button>
            </div>
            <div aria-live="polite">
                {message ? (
                    <p className="text-xs text-muted-foreground">{message}</p>
                ) : null}
                {error ? <FieldError>{error}</FieldError> : null}
                {validation.success ? null : (
                    <FieldError errors={validation.error.issues} />
                )}
            </div>
        </div>
    );
}
