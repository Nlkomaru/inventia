import { Input } from "@base-ui/react/input";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Boxes, PackageOpen, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../components/Button";
import {
	type InventoryRecord,
	InventoryTable,
} from "../components/InventoryTable";

export const Route = createFileRoute("/")({ component: Home });

const inventoryData: InventoryRecord[] = [
	{
		id: "item-001",
		name: "無印良品 ポリプロピレン収納ケース",
		category: "日用品 / 収納",
		location: "クローゼット",
		quantity: 4,
		unit: "個",
		status: "在庫あり",
		expiryDate: null,
	},
	{
		id: "item-002",
		name: "キリン 午後の紅茶 ストレートティー",
		category: "食品 / 飲料",
		location: "キッチン棚 A",
		quantity: 2,
		unit: "本",
		status: "残りわずか",
		expiryDate: "2026-09-18",
	},
	{
		id: "item-003",
		name: "サントリー 天然水 2L",
		category: "食品 / 飲料",
		location: "パントリー",
		quantity: 0,
		unit: "本",
		status: "在庫切れ",
		expiryDate: "2027-01-22",
	},
	{
		id: "item-004",
		name: "ゼブラ 油性ボールペン",
		category: "日用品 / 文房具",
		location: "書斎デスク",
		quantity: 12,
		unit: "本",
		status: "在庫あり",
		expiryDate: null,
	},
	{
		id: "item-005",
		name: "世界の歴史 1 古代文明の誕生",
		category: "書籍 / 歴史",
		location: "本棚 01",
		quantity: 1,
		unit: "冊",
		status: "残りわずか",
		expiryDate: null,
	},
];

const statusFilters = ["すべて", "在庫あり", "残りわずか", "在庫切れ"] as const;
type StatusFilter = (typeof statusFilters)[number];

function Home() {
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("すべて");
	const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
	const filteredInventory = inventoryData.filter((item) => {
		const matchesStatus =
			statusFilter === "すべて" || item.status === statusFilter;
		const matchesQuery =
			normalizedQuery.length === 0 ||
			[item.name, item.category, item.location].some((value) =>
				value.toLocaleLowerCase("ja-JP").includes(normalizedQuery),
			);

		return matchesStatus && matchesQuery;
	});
	const lowStockCount = inventoryData.filter(
		(item) => item.status === "残りわずか",
	).length;
	const outOfStockCount = inventoryData.filter(
		(item) => item.status === "在庫切れ",
	).length;

	return (
		<div className="min-h-screen bg-[#f5f7fb] text-slate-950">
			<header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
				<div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
					<div className="flex items-center gap-3">
						<div className="grid size-9 place-items-center rounded-lg bg-indigo-600 text-sm font-black text-white shadow-[0_8px_20px_-12px_rgba(79,70,229,0.9)]">
							IN
						</div>
						<div>
							<p className="text-sm font-black tracking-tight">Inventia</p>
							<p className="text-[11px] font-medium text-slate-500">
								暮らしの在庫を、静かに整える
							</p>
						</div>
					</div>
					<div className="hidden items-center gap-2 text-xs font-semibold text-slate-500 sm:flex">
						<span className="size-2 rounded-full bg-emerald-500" />
						同期済み · たった今
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-7xl px-6 py-10 lg:px-8 lg:py-14">
				<div className="max-w-2xl">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
						Inventory overview
					</p>
					<h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">
						家の在庫を見渡す
					</h1>
					<p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
						品目の状態、保管場所、期限をひとつの一覧で確認できます。
					</p>
				</div>

				<div className="mt-9 grid gap-4 sm:grid-cols-3">
					<SummaryCard
						icon={<Boxes aria-hidden="true" className="size-5" />}
						label="品目数"
						value={`${inventoryData.length} 件`}
						tone="indigo"
					/>
					<SummaryCard
						icon={<AlertTriangle aria-hidden="true" className="size-5" />}
						label="補充が必要"
						value={`${lowStockCount} 件`}
						tone="amber"
					/>
					<SummaryCard
						icon={<PackageOpen aria-hidden="true" className="size-5" />}
						label="在庫切れ"
						value={`${outOfStockCount} 件`}
						tone="rose"
					/>
				</div>

				<section className="mt-10" aria-labelledby="inventory-heading">
					<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
								Your collection
							</p>
							<h2
								className="mt-1 text-xl font-bold tracking-tight"
								id="inventory-heading"
							>
								すべての品目
							</h2>
						</div>
						<label className="relative block w-full" htmlFor="inventory-search">
							<span className="sr-only">品目を検索</span>
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-400"
							/>
							<Input
								id="inventory-search"
								aria-label="品目を検索"
								className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition-shadow placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="品目・場所・カテゴリーを検索"
								value={query}
							/>
						</label>
					</div>

					<div className="mt-5 flex flex-wrap items-center gap-2">
						{statusFilters.map((filter) => (
							<Button
								className="min-h-9 rounded-full px-3.5 py-1.5 text-xs"
								key={filter}
								onClick={() => setStatusFilter(filter)}
								size="sm"
								variant={statusFilter === filter ? "primary" : "secondary"}
							>
								{filter}
							</Button>
						))}
					</div>

					<div className="mt-4">
						<InventoryTable data={filteredInventory} />
					</div>
				</section>
			</main>
		</div>
	);
}

function SummaryCard({
	icon,
	label,
	tone,
	value,
}: {
	icon: ReactNode;
	label: string;
	tone: "indigo" | "amber" | "rose";
	value: string;
}) {
	const toneStyles = {
		indigo: "bg-indigo-50 text-indigo-600",
		amber: "bg-amber-50 text-amber-600",
		rose: "bg-rose-50 text-rose-600",
	};

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)]">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-xs font-semibold text-slate-500">{label}</p>
					<p className="mt-3 text-2xl font-black tracking-tight">{value}</p>
				</div>
				<div
					className={`grid size-10 place-items-center rounded-lg ${toneStyles[tone]}`}
				>
					{icon}
				</div>
			</div>
		</div>
	);
}
