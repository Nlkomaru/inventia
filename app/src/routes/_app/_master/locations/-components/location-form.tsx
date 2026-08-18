import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { FormEvent } from "react";
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
import type { LocationDto } from "@/domain/location";
import {
    editingLocationAtom,
    locationFormAtom,
    locationFormSavingAtom,
    startLocationEditAtom,
} from "./location-atoms";

type Props = {
    locations: LocationDto[];
    onSave: (input: {
        name: string;
        parentId: string | null;
        sortOrder: number;
    }) => Promise<void>;
};

export function LocationForm({ locations, onSave }: Props) {
    const editing = useAtomValue(editingLocationAtom);
    const startEdit = useSetAtom(startLocationEditAtom);
    const [form, setForm] = useAtom(locationFormAtom);
    const [saving, setSaving] = useAtom(locationFormSavingAtom);
    const parentOptions = [
        { label: "最上位", value: null },
        ...locations
            .filter((location) => location.id !== editing?.id)
            .map((location) => ({ label: location.name, value: location.id })),
    ];

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            await onSave({
                name: form.name.trim(),
                parentId: form.parentId,
                sortOrder: Number(form.sortOrder),
            });
            startEdit(null);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section aria-labelledby="registration-title">
            <div className="mb-5 flex items-center gap-3">
                <h2 id="registration-title" className="font-bold">
                    {editing ? "登録内容を編集" : "新しい保管場所を登録"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-4" onSubmit={submit}>
                <Field>
                    <FieldLabel htmlFor="location-name">場所名</FieldLabel>
                    <Input
                        id="location-name"
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
                    <FieldLabel htmlFor="location-parent">親階層</FieldLabel>
                    <Select
                        items={parentOptions}
                        value={form.parentId}
                        onValueChange={(parentId) =>
                            setForm((current) => ({ ...current, parentId }))
                        }
                    >
                        <SelectTrigger id="location-parent" className="w-full">
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
                    <FieldLabel htmlFor="location-sort-order">
                        並び順
                    </FieldLabel>
                    <Input
                        id="location-sort-order"
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
