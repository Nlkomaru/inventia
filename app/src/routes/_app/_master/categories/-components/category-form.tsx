import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
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
    type CategoryDto,
    type CategoryKind,
    categoryKindSchema,
} from "@/domain/category";
import {
    categoryKindLabels,
    categoryKindUnsetLabel,
} from "../-functions/effective-kind";
import {
    categoryFormAtom,
    categoryFormGenerationAtom,
    categoryFormSavingAtom,
    editingCategoryIdAtom,
    finishCategorySaveAtom,
    startCategoryEditAtom,
} from "./category-atoms";

type Props = {
    categories: CategoryDto[];
    onSave: (input: {
        name: string;
        parentId: string | null;
        kind: CategoryKind | null;
        sortOrder: number;
    }) => Promise<void>;
};

const kindOptions: { label: string; value: CategoryKind | null }[] = [
    { label: categoryKindUnsetLabel, value: null },
    ...categoryKindSchema.options.map((kind) => ({
        label: categoryKindLabels[kind],
        value: kind,
    })),
];

export function CategoryForm({ categories, onSave }: Props) {
    const editingId = useAtomValue(editingCategoryIdAtom);
    const generation = useAtomValue(categoryFormGenerationAtom);
    const startEdit = useSetAtom(startCategoryEditAtom);
    const finishSave = useSetAtom(finishCategorySaveAtom);
    const [form, setForm] = useAtom(categoryFormAtom);
    const [saving, setSaving] = useAtom(categoryFormSavingAtom);
    const parentOptions: { label: string; value: string | null }[] = [
        { label: "最上位", value: null },
        ...categories
            .filter((category) => category.id !== editingId)
            .map((category) => ({ label: category.name, value: category.id })),
    ];

    // 他所で削除されたカテゴリを編集し続けると保存が 404 になるため、編集を解除する
    useEffect(() => {
        if (
            editingId !== null &&
            !categories.some((category) => category.id === editingId)
        ) {
            startEdit(null);
        }
    }, [categories, editingId, startEdit]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        // 保存を待つ間に別の行を選び直したかを、完了時に連番で判定する
        const saved = generation;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                parentId: form.parentId,
                kind: form.kind,
                sortOrder: Number(form.sortOrder),
            });
            finishSave(saved);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section aria-labelledby="category-registration-title">
            <div className="mb-5 flex items-center gap-3">
                <h2 id="category-registration-title" className="font-bold">
                    {editingId === null
                        ? "新しいカテゴリを登録"
                        : "登録内容を編集"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-5" onSubmit={submit}>
                <Field>
                    <FieldLabel htmlFor="category-name">カテゴリ名</FieldLabel>
                    <Input
                        id="category-name"
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
                    <FieldLabel htmlFor="category-parent">親階層</FieldLabel>
                    <Select
                        items={parentOptions}
                        value={form.parentId}
                        onValueChange={(parentId) =>
                            setForm((current) => ({ ...current, parentId }))
                        }
                    >
                        <SelectTrigger id="category-parent" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {parentOptions.map((option) => (
                                    <SelectItem
                                        key={option.value ?? "root"}
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
                    <FieldLabel htmlFor="category-kind">種別</FieldLabel>
                    <Select
                        items={kindOptions}
                        value={form.kind}
                        onValueChange={(kind) =>
                            setForm((current) => ({ ...current, kind }))
                        }
                    >
                        <SelectTrigger id="category-kind" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {kindOptions.map((option) => (
                                    <SelectItem
                                        key={option.value ?? "unset"}
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
                    <FieldLabel htmlFor="category-sort-order">
                        並び順
                    </FieldLabel>
                    <Input
                        id="category-sort-order"
                        type="number"
                        value={form.sortOrder}
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                sortOrder: event.target.value,
                            }))
                        }
                    />
                </Field>
                <div className="flex items-end gap-2">
                    <Button className="flex-1" disabled={saving} type="submit">
                        {saving
                            ? "保存中…"
                            : editingId === null
                              ? "登録する"
                              : "変更を保存"}
                    </Button>
                    {editingId === null ? null : (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => startEdit(null)}
                        >
                            取消
                        </Button>
                    )}
                </div>
            </form>
        </section>
    );
}
