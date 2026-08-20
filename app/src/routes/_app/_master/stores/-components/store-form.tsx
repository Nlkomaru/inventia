import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FileImage, StoreIcon, X } from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    storeFaviconContentTypes,
    storeFaviconMaxByteSize,
} from "@/domain/store";
import {
    editingStoreAtom,
    finishStoreSaveAtom,
    startStoreEditAtom,
    storeFaviconErrorAtom,
    storeFormAtom,
    storeFormGenerationAtom,
    storeFormSavingAtom,
} from "./store-atoms";

export type StoreSaveInput = {
    name: string;
    url: string | null;
    /** 選ばれた新しいファビコン画像。null なら画像を差し替えない。 */
    faviconFile: File | null;
    /** 既存のファビコンを削除する。 */
    removeFavicon: boolean;
};

const faviconAccept = storeFaviconContentTypes.join(",");
const hintId = "store-favicon-hint";
const errorId = "store-favicon-error";

const megabytes = (bytes: number): string =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// アップロード前の検証。上限を超えた画像を送っても service 側で 413 になるため、
// 同じ条件を画面側でも確かめて選び直しをその場で促す
const validateFavicon = (file: File): string | null => {
    if (file.size === 0) return "空のファイルは取り込めません";
    if (!storeFaviconContentTypes.some((allowed) => allowed === file.type)) {
        return "PNG・JPEG・WebP の画像を選んでください";
    }
    if (file.size > storeFaviconMaxByteSize) {
        return `画像は ${megabytes(storeFaviconMaxByteSize)} 以下にしてください`;
    }
    return null;
};

type Props = {
    onSave: (input: StoreSaveInput) => Promise<void>;
};

export function StoreForm({ onSave }: Props) {
    const editing = useAtomValue(editingStoreAtom);
    const generation = useAtomValue(storeFormGenerationAtom);
    const startEdit = useSetAtom(startStoreEditAtom);
    const finishSave = useSetAtom(finishStoreSaveAtom);
    const [form, setForm] = useAtom(storeFormAtom);
    const [saving, setSaving] = useAtom(storeFormSavingAtom);
    const [faviconError, setFaviconError] = useAtom(storeFaviconErrorAtom);
    // 保存済みの画像は、削除を選んでいる間と差し替え画像を選んだ後は出さない
    const currentFaviconUrl =
        editing && !form.faviconRemoved && form.faviconFile === null
            ? editing.faviconUrl
            : null;

    const selectFavicon = (event: ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0];
        // 同じファイルを選び直したときも change が発火するよう value を戻す
        event.target.value = "";
        if (selected === undefined) return;
        const invalid = validateFavicon(selected);
        if (invalid !== null) {
            setFaviconError(invalid);
            return;
        }
        setFaviconError(null);
        setForm((current) => ({
            ...current,
            faviconFile: selected,
            faviconRemoved: false,
        }));
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        if (faviconError !== null) return;
        // 保存を待つ間に別の行を選び直したかを、完了時に連番で判定する
        const saved = generation;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                url: form.url.trim() ? form.url.trim() : null,
                faviconFile: form.faviconFile,
                removeFavicon: form.faviconRemoved,
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
                    {editing ? "登録内容を編集" : "新しい店舗を登録"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-4" onSubmit={submit}>
                <Field className="md:col-span-2">
                    <FieldLabel htmlFor="store-name">店名</FieldLabel>
                    <Input
                        id="store-name"
                        required
                        value={form.name}
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                name: event.target.value,
                            }))
                        }
                    />
                    <div className="flex items-center gap-3">
                        {currentFaviconUrl === null ? (
                            <StoreIcon
                                aria-hidden="true"
                                className="size-8 shrink-0 rounded-sm border p-1.5 text-muted-foreground"
                            />
                        ) : (
                            <img
                                alt=""
                                className="size-8 shrink-0 rounded-sm border object-contain"
                                // 差し替え後も古い画像が残らないよう更新時刻を付ける
                                src={`${currentFaviconUrl}?v=${encodeURIComponent(editing?.updatedAt ?? "")}`}
                            />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <FieldLabel
                                className="text-xs font-normal text-muted-foreground"
                                htmlFor="store-favicon"
                            >
                                ファビコン画像
                            </FieldLabel>
                            <Input
                                accept={faviconAccept}
                                aria-describedby={
                                    faviconError === null
                                        ? hintId
                                        : `${hintId} ${errorId}`
                                }
                                id="store-favicon"
                                // 選択を取り消したときに入力欄の表示も戻す
                                key={`${generation}-${form.faviconFile?.name ?? "none"}`}
                                onChange={selectFavicon}
                                type="file"
                            />
                        </div>
                        {currentFaviconUrl === null ? null : (
                            <Button
                                aria-label="登録済みのファビコン画像を削除"
                                disabled={saving}
                                onClick={() =>
                                    setForm((current) => ({
                                        ...current,
                                        faviconRemoved: true,
                                    }))
                                }
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                画像を削除
                            </Button>
                        )}
                    </div>
                    {form.faviconFile === null ? null : (
                        <div className="flex items-center gap-3 rounded-lg border p-2">
                            <FileImage
                                aria-hidden="true"
                                className="size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate text-sm">
                                {form.faviconFile.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {megabytes(form.faviconFile.size)}
                            </span>
                            <Button
                                aria-label={`${form.faviconFile.name} の選択を取り消す`}
                                className="ml-auto"
                                disabled={saving}
                                onClick={() =>
                                    setForm((current) => ({
                                        ...current,
                                        faviconFile: null,
                                    }))
                                }
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                            >
                                <X />
                            </Button>
                        </div>
                    )}
                    <FieldDescription id={hintId}>
                        PNG・JPEG・WebP を {megabytes(storeFaviconMaxByteSize)}{" "}
                        まで。
                        {form.faviconRemoved
                            ? "保存すると登録済みの画像を削除します。"
                            : null}
                    </FieldDescription>
                    <FieldError id={errorId}>{faviconError}</FieldError>
                </Field>
                <Field>
                    <FieldLabel htmlFor="store-url">URL</FieldLabel>
                    <Input
                        id="store-url"
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
                    <Button
                        className="flex-1"
                        disabled={saving || faviconError !== null}
                        type="submit"
                    >
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
