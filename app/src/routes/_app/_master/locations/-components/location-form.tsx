import { useAtom } from "jotai";
import { CirclePlus } from "lucide-react";
import { type FormEvent, useEffect } from "react";
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
import type { LocationDto } from "@/domain/location";
import {
    editingLocationAtom,
    locationFormAtom,
    locationFormSavingAtom,
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
    const [editing, setEditing] = useAtom(editingLocationAtom);
    const [form, setForm] = useAtom(locationFormAtom);
    const [saving, setSaving] = useAtom(locationFormSavingAtom);
    const parentOptions = [
        { label: "最上位", value: null },
        ...locations
            .filter((location) => location.id !== editing?.id)
            .map((location) => ({ label: location.name, value: location.id })),
    ];

    useEffect(() => {
        setForm({
            name: editing?.name ?? "",
            parentId: editing?.parentId ?? null,
            sortOrder: String(editing?.sortOrder ?? 0),
        });
    }, [editing, setForm]);

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
            setEditing(null);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section
            className="rounded-2xl border bg-white p-5 shadow-sm"
            aria-labelledby="registration-title"
        >
            <div className="mb-5 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-slate-950 text-white">
                    <CirclePlus className="size-4" />
                </span>
                <h2 id="registration-title" className="font-bold">
                    {editing ? "登録内容を編集" : "新しい保管場所を登録"}
                </h2>
            </div>
            <form className="grid gap-4 md:grid-cols-4" onSubmit={submit}>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="location-name"
                >
                    場所名
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
                </label>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="location-parent"
                >
                    親階層
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
                </label>
                <label
                    className="space-y-1.5 text-xs font-semibold"
                    htmlFor="location-sort-order"
                >
                    並び順
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
                </label>
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
                            onClick={() => setEditing(null)}
                        >
                            取消
                        </Button>
                    ) : null}
                </div>
            </form>
        </section>
    );
}
