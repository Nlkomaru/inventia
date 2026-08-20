import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    externalProviderNameMaxLength,
    externalProviderUrlSchema,
} from "@/domain/externalProvider";
import {
    editingProviderAtom,
    finishProviderSaveAtom,
    providerFormAtom,
    providerFormGenerationAtom,
    providerFormSavingAtom,
    startProviderEditAtom,
} from "./provider-atoms";
import { ProviderFavicon } from "./provider-favicon";

export type ProviderSaveInput = {
    name: string;
    /** null は「設定しない・消去する」を表す。 */
    faviconUrl: string | null;
    url: string | null;
};

const hintId = "provider-favicon-hint";

/** 空欄は URL 未設定として null にする（空文字は URL として拒否されるため）。 */
const optionalUrl = (value: string): string | null =>
    value.trim() ? value.trim() : null;

/** 入力途中の値で画像を読みに行かないよう、URL として妥当なものだけ表示する。 */
const previewUrl = (value: string): string | null => {
    const trimmed = optionalUrl(value);
    return trimmed !== null &&
        externalProviderUrlSchema.safeParse(trimmed).success
        ? trimmed
        : null;
};

type Props = {
    onSave: (input: ProviderSaveInput) => Promise<void>;
};

export function ProviderForm({ onSave }: Props) {
    const editing = useAtomValue(editingProviderAtom);
    const generation = useAtomValue(providerFormGenerationAtom);
    const startEdit = useSetAtom(startProviderEditAtom);
    const finishSave = useSetAtom(finishProviderSaveAtom);
    const [form, setForm] = useAtom(providerFormAtom);
    const [saving, setSaving] = useAtom(providerFormSavingAtom);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        // 保存を待つ間に別の行を選び直したかを、完了時に連番で判定する
        const saved = generation;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                faviconUrl: optionalUrl(form.faviconUrl),
                url: optionalUrl(form.url),
            });
            finishSave(saved);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section aria-labelledby="registration-title">
            <div className="mb-5 flex items-center gap-3">
                <h2 id="registration-title" className="font-bold">
                    {editing ? "登録内容を編集" : "新しい連携先を登録"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-4" onSubmit={submit}>
                <Field>
                    <FieldLabel htmlFor="provider-name">連携先名</FieldLabel>
                    <Input
                        id="provider-name"
                        maxLength={externalProviderNameMaxLength}
                        required
                        value={form.name}
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                name: event.target.value,
                            }))
                        }
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="provider-favicon-url">
                        ファビコン URL
                    </FieldLabel>
                    <div className="flex items-center gap-2">
                        <ProviderFavicon
                            faviconUrl={previewUrl(form.faviconUrl)}
                        />
                        <Input
                            aria-describedby={hintId}
                            id="provider-favicon-url"
                            inputMode="url"
                            placeholder="https://example.com/favicon.ico"
                            type="url"
                            value={form.faviconUrl}
                            onChange={(event) =>
                                setForm((current) => ({
                                    ...current,
                                    faviconUrl: event.target.value,
                                }))
                            }
                        />
                    </div>
                    <FieldDescription id={hintId}>
                        画像は保管せず、この URL をそのまま表示します。
                    </FieldDescription>
                </Field>
                <Field>
                    <FieldLabel htmlFor="provider-url">URL</FieldLabel>
                    <Input
                        id="provider-url"
                        inputMode="url"
                        placeholder="https://example.com"
                        type="url"
                        value={form.url}
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                url: event.target.value,
                            }))
                        }
                    />
                </Field>
                <div className="flex items-end gap-2">
                    <Button className="flex-1" disabled={saving} type="submit">
                        {saving
                            ? "保存中…"
                            : editing
                              ? "変更を保存"
                              : "登録する"}
                    </Button>
                    {editing ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => startEdit(null)}
                        >
                            取消
                        </Button>
                    ) : null}
                </div>
            </form>
        </section>
    );
}
