import { useAtom, useAtomValue } from "jotai";
import { CirclePlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { editingLocationAtom, locationsAtom } from "./-location-atoms";

type Props = {
	onSave: (input: {
		name: string;
		parentId: string | null;
		sortOrder: number;
	}) => Promise<void>;
};

export function LocationForm({ onSave }: Props) {
	const locations = useAtomValue(locationsAtom);
	const [editing, setEditing] = useAtom(editingLocationAtom);
	const [name, setName] = useState("");
	const [parentId, setParentId] = useState("");
	const [sortOrder, setSortOrder] = useState("0");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setName(editing?.name ?? "");
		setParentId(editing?.parentId ?? "");
		setSortOrder(String(editing?.sortOrder ?? 0));
	}, [editing]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return;
		setSaving(true);
		try {
			await onSave({
				name: name.trim(),
				parentId: parentId || null,
				sortOrder: Number(sortOrder),
			});
			setEditing(null);
			setName("");
			setParentId("");
			setSortOrder("0");
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
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label
					className="space-y-1.5 text-xs font-semibold"
					htmlFor="location-parent"
				>
					親階層
					<select
						id="location-parent"
						className="h-8 w-full rounded-lg border bg-white px-2.5 text-sm"
						value={parentId}
						onChange={(event) => setParentId(event.target.value)}
					>
						<option value="">最上位</option>
						{locations
							.filter((location) => location.id !== editing?.id)
							.map((location) => (
								<option key={location.id} value={location.id}>
									{location.name}
								</option>
							))}
					</select>
				</label>
				<label
					className="space-y-1.5 text-xs font-semibold"
					htmlFor="location-sort-order"
				>
					並び順
					<Input
						id="location-sort-order"
						type="number"
						value={sortOrder}
						onChange={(event) => setSortOrder(event.target.value)}
					/>
				</label>
				<div className="flex items-end gap-2">
					<Button className="flex-1" disabled={saving} type="submit">
						{saving ? "保存中…" : editing ? "変更を保存" : "登録する"}
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
