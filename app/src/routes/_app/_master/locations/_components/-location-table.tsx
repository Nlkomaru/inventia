import { Button as BaseButton } from "@base-ui/react/button";
import { useAtom, useAtomValue } from "jotai";
import {
	ChevronDown,
	ChevronRight,
	Pencil,
	Search,
	Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	editingLocationAtom,
	expandedLocationIdsAtom,
	locationQueryAtom,
	locationsAtom,
} from "./-location-atoms";

export function LocationTable({
	onDelete,
}: {
	onDelete: (id: string) => Promise<void>;
}) {
	const locations = useAtomValue(locationsAtom);
	const [query, setQuery] = useAtom(locationQueryAtom);
	const [expanded, setExpanded] = useAtom(expandedLocationIdsAtom);
	const [, setEditing] = useAtom(editingLocationAtom);
	const rows = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase("ja");
		if (normalized)
			return locations
				.filter((item) =>
					item.name.toLocaleLowerCase("ja").includes(normalized),
				)
				.map((item) => ({ item, depth: 0 }));
		const result: Array<{ item: (typeof locations)[number]; depth: number }> =
			[];
		const visit = (parentId: string | null, depth: number) =>
			locations
				.filter((item) => item.parentId === parentId)
				.forEach((item) => {
					result.push({ item, depth });
					if (expanded.has(item.id)) visit(item.id, depth + 1);
				});
		visit(null, 0);
		return result;
	}, [expanded, locations, query]);

	return (
		<section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
			<div className="flex items-center justify-between border-b p-5">
				<div>
					<h2 className="font-bold">登録済み保管場所</h2>
					<p className="text-xs text-slate-500">
						{locations.length} 件 · D1に保存された場所
					</p>
				</div>
				<label className="relative" htmlFor="location-search">
					<Search className="absolute left-3 top-2.5 size-4" />
					<span className="sr-only">検索</span>
					<Input
						id="location-search"
						className="pl-9"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[600px] text-left text-sm">
					<thead className="bg-slate-50">
						<tr>
							<th className="px-5 py-3">場所名</th>
							<th className="px-5 py-3">並び順</th>
							<th className="px-5 py-3 text-right">操作</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map(({ item, depth }) => {
							const hasChildren = locations.some(
								(candidate) => candidate.parentId === item.id,
							);
							return (
								<tr key={item.id}>
									<td className="px-5 py-3">
										<div
											className="flex items-center"
											style={{ paddingLeft: depth * 24 }}
										>
											<BaseButton
												className="mr-2 grid size-7 place-items-center"
												disabled={!hasChildren}
												onClick={() =>
													setExpanded((current) => {
														const next = new Set(current);
														next.has(item.id)
															? next.delete(item.id)
															: next.add(item.id);
														return next;
													})
												}
												aria-label={`${item.name}を展開`}
											>
												{expanded.has(item.id) ? (
													<ChevronDown />
												) : (
													<ChevronRight />
												)}
											</BaseButton>
											{item.name}
										</div>
									</td>
									<td className="px-5 py-3">{item.sortOrder}</td>
									<td className="px-5 py-3">
										<div className="flex justify-end">
											<Button
												size="icon-sm"
												variant="ghost"
												onClick={() => setEditing(item)}
												aria-label={`${item.name}を編集`}
											>
												<Pencil />
											</Button>
											<Button
												size="icon-sm"
												variant="ghost"
												disabled={hasChildren}
												onClick={() => void onDelete(item.id)}
												aria-label={`${item.name}を削除`}
											>
												<Trash2 />
											</Button>
										</div>
									</td>
								</tr>
							);
						})}
						{rows.length === 0 ? (
							<tr>
								<td
									className="px-5 py-16 text-center text-slate-500"
									colSpan={3}
								>
									保管場所が登録されていません
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</section>
	);
}
