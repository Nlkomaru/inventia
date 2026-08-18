import { useAtom } from "jotai";
import { CirclePlus } from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
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
    categoryFormSavingAtom,
    editingCategoryIdAtom,
    initialCategoryFormState,
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
    const [editingId, setEditingId] = useAtom(editingCategoryIdAtom);
    const [form, setForm] = useAtom(categoryFormAtom);
    const [saving, setSaving] = useAtom(categoryFormSavingAtom);
    const parentOptions: { label: string; value: string | null }[] = [
        { label: "最上位", value: null },
        ...categories
            .filter((category) => category.id !== editingId)
            .map((category) => ({ label: category.name, value: category.id })),
    ];

    // 初期化 effect より先に走らせて、editingId が変わった時点の一覧を読ませる
    const categoriesRef = useRef(categories);
    useEffect(() => {
        categoriesRef.current = categories;
    });

    // 一覧の再取得で入力中の値を消さないよう、初期化は editingId の変化にだけ反応させる
    useEffect(() => {
        const target =
            editingId === null
                ? null
                : (categoriesRef.current.find(
                      (category) => category.id === editingId,
                  ) ?? null);
        setForm({
            name: target?.name ?? "",
            parentId: target?.parentId ?? null,
            kind: target?.kind ?? null,
            sortOrder: String(target?.sortOrder ?? 0),
        });
    }, [editingId, setForm]);

    // 他所で削除されたカテゴリを編集し続けると保存が 404 になるため、編集を解除する
    useEffect(() => {
        if (
            editingId !== null &&
            !categories.some((category) => category.id === editingId)
        ) {
            setEditingId(null);
        }
    }, [categories, editingId, setEditingId]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                parentId: form.parentId,
                kind: form.kind,
                sortOrder: Number(form.sortOrder),
            });
            // 新規登録では editingId が変わらず初期化 effect が走らないため明示的に戻す
            if (editingId === null) {
                setForm(initialCategoryFormState);
            } else {
                setEditingId(null);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <section
            className="rounded-2xl border bg-card p-5 shadow-sm"
            aria-labelledby="category-registration-title"
        >
            <div className="mb-5 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                    <CirclePlus className="size-4" />
                </span>
                <h2 id="category-registration-title" className="font-bold">
                    {editingId === null
                        ? "新しいカテゴリを登録"
                        : "登録内容を編集"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-5" onSubmit={submit}>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="category-name"
                >
                    カテゴリ名
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
                </label>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="category-parent"
                >
                    親階層
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
                </label>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="category-kind"
                >
                    種別
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
                </label>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="category-sort-order"
                >
                    並び順
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
                </label>
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
                            onClick={() => setEditingId(null)}
                        >
                            取消
                        </Button>
                    )}
                </div>
            </form>
        </section>
    );
}
