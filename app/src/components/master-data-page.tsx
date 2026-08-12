import { Button as BaseButton } from "@base-ui/react/button";
import {
	ChevronDown,
	ChevronRight,
	CirclePlus,
	FolderTree,
	Pencil,
	Search,
	Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MasterRecord = {
	id: string;
	name: string;
	code: string;
	parentId?: string;
	detail: string;
};

type MasterDataPageProps = {
	title: string;
	description: string;
	nameLabel: string;
	codeLabel: string;
	detailLabel: string;
	hierarchical?: boolean;
	initialRecords: MasterRecord[];
};

const makeId = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `master-${Date.now()}`;

export function MasterDataPage({
	title,
	description,
	nameLabel,
	codeLabel,
	detailLabel,
	hierarchical = false,
	initialRecords,
}: MasterDataPageProps) {
	const storageKey = `inventia-master-${title}`;
	const [records, setRecords] = useState<MasterRecord[]>(() => {
		if (typeof window === "undefined") return initialRecords;
		const saved = window.localStorage.getItem(storageKey);
		if (!saved) return initialRecords;
		try {
			return JSON.parse(saved) as MasterRecord[];
		} catch {
			return initialRecords;
		}
	});
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [detail, setDetail] = useState("");
	const [parentId, setParentId] = useState("");
	const [query, setQuery] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(
		() => new Set(initialRecords.map((r) => r.id)),
	);

	const persist = (next: MasterRecord[]) => {
		setRecords(next);
		window.localStorage.setItem(storageKey, JSON.stringify(next));
	};

	const resetForm = () => {
		setName("");
		setCode("");
		setDetail("");
		setParentId("");
		setEditingId(null);
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim() || !code.trim()) return;
		if (editingId) {
			persist(
				records.map((record) =>
					record.id === editingId
						? {
								...record,
								name: name.trim(),
								code: code.trim(),
								detail: detail.trim(),
								parentId: hierarchical ? parentId || undefined : undefined,
							}
						: record,
				),
			);
		} else {
			persist([
				...records,
				{
					id: makeId(),
					name: name.trim(),
					code: code.trim(),
					detail: detail.trim(),
					parentId: hierarchical ? parentId || undefined : undefined,
				},
			]);
		}
		resetForm();
	};

	const edit = (record: MasterRecord) => {
		setEditingId(record.id);
		setName(record.name);
		setCode(record.code);
		setDetail(record.detail);
		setParentId(record.parentId ?? "");
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	const remove = (id: string) => {
		if (records.some((record) => record.parentId === id)) return;
		persist(records.filter((record) => record.id !== id));
	};

	const visibleRecords = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase("ja");
		if (normalized)
			return records
				.filter((record) =>
					`${record.name} ${record.code} ${record.detail}`
						.toLocaleLowerCase("ja")
						.includes(normalized),
				)
				.map((record) => ({ record, depth: 0 }));
		if (!hierarchical) return records.map((record) => ({ record, depth: 0 }));
		const result: Array<{ record: MasterRecord; depth: number }> = [];
		const visit = (parent: string | undefined, depth: number) => {
			for (const record of records.filter(
				(candidate) => candidate.parentId === parent,
			)) {
				result.push({ record, depth });
				if (expanded.has(record.id)) visit(record.id, depth + 1);
			}
		};
		visit(undefined, 0);
		return result;
	}, [expanded, hierarchical, query, records]);

	return (
		<main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
			<header>
				<p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-500">
					Master data
				</p>
				<h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
					{title}マスタ
				</h1>
				<p className="mt-2 text-sm text-slate-500">{description}</p>
			</header>

			<section
				className="rounded-2xl border bg-white p-5 shadow-sm"
				aria-labelledby="registration-title"
			>
				<div className="mb-5 flex items-center gap-3">
					<span className="grid size-9 place-items-center rounded-lg bg-slate-950 text-white">
						<CirclePlus className="size-4" />
					</span>
					<div>
						<h2 id="registration-title" className="font-bold">
							{editingId ? "登録内容を編集" : `新しい${title}を登録`}
						</h2>
						<p className="text-xs text-slate-500">
							必須項目を入力して保存してください
						</p>
					</div>
				</div>
				<form
					className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
					onSubmit={submit}
				>
					<Field label={nameLabel} required>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={`${nameLabel}を入力`}
						/>
					</Field>
					<Field label={codeLabel} required>
						<Input
							value={code}
							onChange={(e) => setCode(e.target.value)}
							placeholder="例: 001"
						/>
					</Field>
					{hierarchical ? (
						<Field label="親階層">
							<select
								className="h-8 w-full rounded-lg border bg-white px-2.5 text-sm"
								value={parentId}
								onChange={(e) => setParentId(e.target.value)}
							>
								<option value="">最上位</option>
								{records
									.filter((r) => r.id !== editingId)
									.map((r) => (
										<option key={r.id} value={r.id}>
											{r.name}
										</option>
									))}
							</select>
						</Field>
					) : null}
					<Field label={detailLabel}>
						<Input
							value={detail}
							onChange={(e) => setDetail(e.target.value)}
							placeholder={`${detailLabel}を入力`}
						/>
					</Field>
					<div className="flex items-end gap-2 xl:col-start-4">
						<Button className="h-9 flex-1" type="submit">
							{editingId ? "変更を保存" : "登録する"}
						</Button>
						{editingId ? (
							<Button
								className="h-9"
								variant="outline"
								type="button"
								onClick={resetForm}
							>
								取消
							</Button>
						) : null}
					</div>
				</form>
			</section>

			<section
				className="overflow-hidden rounded-2xl border bg-white shadow-sm"
				aria-labelledby="list-title"
			>
				<div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="flex items-center gap-2">
							<FolderTree className="size-4 text-slate-500" />
							<h2 id="list-title" className="font-bold">
								登録済み{title}
							</h2>
						</div>
						<p className="mt-1 text-xs text-slate-500">
							{records.length} 件 ·{" "}
							{hierarchical
								? "行を開いて階層を確認できます"
								: "登録内容の編集・削除ができます"}
						</p>
					</div>
					{/* biome-ignore lint/a11y/noLabelWithoutControl: Input is a Base UI component rendered inside the label. */}
					<label className="relative block sm:w-72">
						<Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
						<span className="sr-only">検索</span>
						<Input
							className="h-9 pl-9"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="名前・コードで検索"
						/>
					</label>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[700px] text-left text-sm">
						<thead className="bg-slate-50 text-xs text-slate-500">
							<tr>
								<th className="px-5 py-3 font-semibold">{nameLabel}</th>
								<th className="px-5 py-3 font-semibold">{codeLabel}</th>
								<th className="px-5 py-3 font-semibold">{detailLabel}</th>
								<th className="px-5 py-3 text-right font-semibold">操作</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{visibleRecords.map(({ record, depth }) => {
								const hasChildren = records.some(
									(r) => r.parentId === record.id,
								);
								return (
									<tr className="hover:bg-slate-50/80" key={record.id}>
										<td className="px-5 py-3.5 font-medium">
											<div
												className="flex items-center"
												style={{ paddingLeft: depth * 24 }}
											>
												{hierarchical ? (
													<BaseButton
														aria-label={`${record.name}を${expanded.has(record.id) ? "閉じる" : "開く"}`}
														className="mr-2 grid size-7 place-items-center rounded-md hover:bg-slate-200 disabled:opacity-30"
														disabled={!hasChildren}
														onClick={() =>
															setExpanded((current) => {
																const next = new Set(current);
																next.has(record.id)
																	? next.delete(record.id)
																	: next.add(record.id);
																return next;
															})
														}
													>
														{expanded.has(record.id) ? (
															<ChevronDown className="size-4" />
														) : (
															<ChevronRight className="size-4" />
														)}
													</BaseButton>
												) : null}
												{record.name}
											</div>
										</td>
										<td className="px-5 py-3.5 font-mono text-xs text-slate-600">
											{record.code}
										</td>
										<td className="px-5 py-3.5 text-slate-600">
											{record.detail || "—"}
										</td>
										<td className="px-5 py-3.5">
											<div className="flex justify-end gap-1">
												<Button
													size="icon-sm"
													variant="ghost"
													onClick={() => edit(record)}
													aria-label={`${record.name}を編集`}
												>
													<Pencil />
												</Button>
												<Button
													size="icon-sm"
													variant="ghost"
													disabled={hasChildren}
													onClick={() => remove(record.id)}
													aria-label={`${record.name}を削除`}
												>
													<Trash2 />
												</Button>
											</div>
										</td>
									</tr>
								);
							})}
							{visibleRecords.length === 0 ? (
								<tr>
									<td
										className="px-5 py-16 text-center text-slate-500"
										colSpan={4}
									>
										該当するデータがありません
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	);
}

function Field({
	label,
	required,
	children,
}: {
	label: string;
	required?: boolean;
	children: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: controls are Base UI components passed as children.
		<label className="space-y-1.5 text-xs font-semibold text-slate-700">
			<span>
				{label}
				{required ? <span className="ml-1 text-rose-600">*</span> : null}
			</span>
			{children}
		</label>
	);
}
