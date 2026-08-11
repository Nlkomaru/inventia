import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "../components/Button";

export const Route = createFileRoute("/")({ component: Home });

const locationSchema = z.object({
	id: z.string(),
	name: z.string(),
	parentId: z.string().nullable(),
	sortOrder: z.number(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const itemSchema = z.object({
	id: z.string(),
	name: z.string(),
	categoryId: z.string(),
	locationId: z.string(),
	baseUnit: z.string(),
	baseDimension: z.enum(["mass", "volume", "count"]),
	currentQuantity: z.number(),
	expiryDate: z.string().nullable(),
	lowStockThreshold: z.number().nullable(),
	memo: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

type Location = z.infer<typeof locationSchema>;
type Item = z.infer<typeof itemSchema>;

type ItemInput = {
	name: string;
	categoryId: string;
	locationId: string;
	baseUnit?: string;
	baseDimension?: "mass" | "volume" | "count";
	currentQuantity?: number;
	expiryDate?: string;
	lowStockThreshold?: number;
	memo?: string;
};

const fieldClassName =
	"mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 disabled:cursor-not-allowed disabled:bg-slate-100";
const labelClassName = "block text-sm font-semibold text-slate-800";
const helpClassName = "mt-1 text-xs leading-5 text-slate-600";

async function errorMessage(response: Response): Promise<string> {
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}

	const details = z
		.object({
			message: z.string().optional(),
			error: z
				.union([
					z.string(),
					z.object({ message: z.string(), code: z.string().optional() }),
				])
				.optional(),
			detail: z.string().optional(),
		})
		.safeParse(payload);
	if (details.success) {
		const message = [
			details.data.message,
			typeof details.data.error === "string"
				? details.data.error
				: details.data.error?.message,
			details.data.detail,
		].find((value) => value?.trim());
		if (message) {
			return message;
		}
	}

	if (response.status === 404) {
		return "対象が見つかりません。画面を再読み込みして、もう一度お試しください。";
	}
	if (response.status === 409) {
		return "関連するデータと競合しています。親子関係や名前を確認してください。";
	}
	if (response.status === 422 || response.status === 400) {
		return "入力内容を確認して、もう一度お試しください。";
	}
	return "サーバーで処理できませんでした。時間をおいてもう一度お試しください。";
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(url, {
			...init,
			headers: init?.body
				? { "Content-Type": "application/json", ...init.headers }
				: init?.headers,
		});
	} catch {
		throw new Error(
			"ネットワークに接続できませんでした。接続を確認して、もう一度お試しください。",
		);
	}

	if (!response.ok) {
		throw new Error(await errorMessage(response));
	}
	if (response.status === 204) {
		return undefined;
	}
	return response.headers.get("Content-Type")?.includes("application/json")
		? response.json()
		: undefined;
}

function formValue(form: FormData, name: string): string {
	return String(form.get(name) ?? "").trim();
}

function nonNegativeInteger(value: string, label: string): number {
	if (!/^\d+$/u.test(value)) {
		throw new Error(`${label}は0以上の整数で入力してください。`);
	}
	return Number(value);
}

function optionalInteger(value: string, label: string): number | undefined {
	if (!value) {
		return undefined;
	}
	if (!/^-?\d+$/u.test(value)) {
		throw new Error(`${label}は整数で入力してください。`);
	}
	return Number(value);
}

function optionalIsoDate(value: string): string | undefined {
	if (!value) {
		return undefined;
	}
	return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function Home() {
	const [locations, setLocations] = useState<Location[]>([]);
	const [items, setItems] = useState<Item[]>([]);
	const [locationsLoading, setLocationsLoading] = useState(true);
	const [itemsLoading, setItemsLoading] = useState(true);
	const [locationError, setLocationError] = useState<string | null>(null);
	const [itemError, setItemError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [locationSubmitting, setLocationSubmitting] = useState(false);
	const [itemSubmitting, setItemSubmitting] = useState(false);
	const [editingLocation, setEditingLocation] = useState<Location | null>(null);
	const [editingItem, setEditingItem] = useState<Item | null>(null);

	const locationNames = useMemo(
		() => new Map(locations.map((location) => [location.id, location.name])),
		[locations],
	);

	const normalizeLocations = (payload: unknown): Location[] => {
		const parsed = z
			.union([
				z.array(locationSchema),
				z.object({ items: z.array(locationSchema) }),
				z.object({ locations: z.array(locationSchema) }),
			])
			.safeParse(payload);
		if (!parsed.success) {
			throw new Error(
				"場所一覧の応答形式を確認できませんでした。再読み込みしてください。",
			);
		}
		if (Array.isArray(parsed.data)) {
			return parsed.data;
		}
		return "items" in parsed.data ? parsed.data.items : parsed.data.locations;
	};

	const normalizeItems = (payload: unknown): Item[] => {
		const parsed = z
			.union([z.array(itemSchema), z.object({ items: z.array(itemSchema) })])
			.safeParse(payload);
		if (!parsed.success) {
			throw new Error(
				"商品一覧の応答形式を確認できませんでした。再読み込みしてください。",
			);
		}
		return Array.isArray(parsed.data) ? parsed.data : parsed.data.items;
	};

	const refreshLocations = async () => {
		setLocationsLoading(true);
		setLocationError(null);
		try {
			setLocations(normalizeLocations(await request("/api/locations")));
		} catch (error) {
			setLocationError(
				error instanceof Error
					? error.message
					: "場所一覧を取得できませんでした。再読み込みしてください。",
			);
		} finally {
			setLocationsLoading(false);
		}
	};

	const refreshItems = async () => {
		setItemsLoading(true);
		setItemError(null);
		try {
			setItems(normalizeItems(await request("/api/items")));
		} catch (error) {
			setItemError(
				error instanceof Error
					? error.message
					: "商品一覧を取得できませんでした。再読み込みしてください。",
			);
		} finally {
			setItemsLoading(false);
		}
	};

	// The initial fetch intentionally runs once; refresh functions close over stable setters.
	// biome-ignore lint/correctness/useExhaustiveDependencies: initial data load only
	useEffect(() => {
		void refreshLocations();
		void refreshItems();
	}, []);

	const createLocation = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		setLocationError(null);
		setNotice(null);
		setLocationSubmitting(true);

		try {
			const values = new FormData(form);
			await request("/api/locations", {
				method: "POST",
				body: JSON.stringify({
					name: formValue(values, "location-name"),
					parentId: formValue(values, "location-parent") || undefined,
					sortOrder: optionalInteger(
						formValue(values, "location-sort-order"),
						"並び順",
					),
				}),
			});
			form.reset();
			setNotice("場所を追加しました。");
			await refreshLocations();
		} catch (error) {
			setLocationError(
				error instanceof Error
					? error.message
					: "場所を追加できませんでした。入力内容を確認してください。",
			);
		} finally {
			setLocationSubmitting(false);
		}
	};

	const updateLocation = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!editingLocation) {
			return;
		}
		const form = event.currentTarget;
		setLocationError(null);
		setNotice(null);
		setLocationSubmitting(true);

		try {
			const values = new FormData(form);
			const parentId = formValue(values, "edit-location-parent") || null;
			if (parentId === editingLocation.id) {
				throw new Error(
					"場所自身を親には設定できません。別の親を選択してください。",
				);
			}
			await request(
				`/api/locations/${encodeURIComponent(editingLocation.id)}`,
				{
					method: "PATCH",
					body: JSON.stringify({
						name: formValue(values, "edit-location-name"),
						parentId,
						sortOrder: optionalInteger(
							formValue(values, "edit-location-sort-order"),
							"並び順",
						),
					}),
				},
			);
			setEditingLocation(null);
			setNotice("場所を更新しました。");
			await refreshLocations();
		} catch (error) {
			setLocationError(
				error instanceof Error
					? error.message
					: "場所を更新できませんでした。入力内容を確認してください。",
			);
		} finally {
			setLocationSubmitting(false);
		}
	};

	const deleteLocation = async (location: Location) => {
		if (
			!window.confirm(
				`「${location.name}」を削除します。子の場所や紐づく商品がある場合は削除できません。`,
			)
		) {
			return;
		}
		setLocationError(null);
		setNotice(null);
		setLocationSubmitting(true);
		try {
			await request(`/api/locations/${encodeURIComponent(location.id)}`, {
				method: "DELETE",
			});
			if (editingLocation?.id === location.id) {
				setEditingLocation(null);
			}
			setNotice("場所を削除しました。");
			await refreshLocations();
		} catch (error) {
			setLocationError(
				error instanceof Error
					? error.message
					: "場所を削除できませんでした。関連するデータを確認してください。",
			);
		} finally {
			setLocationSubmitting(false);
		}
	};

	const itemInput = (
		values: FormData,
		options: { includeStock?: boolean; includeDefinition?: boolean } = {},
	): ItemInput => {
		const includeStock = options.includeStock ?? true;
		const includeDefinition = options.includeDefinition ?? true;
		const threshold = formValue(values, "item-low-stock-threshold");
		const input: ItemInput = {
			name: formValue(values, "item-name"),
			categoryId: formValue(values, "item-category-id"),
			locationId: formValue(values, "item-location-id"),
			expiryDate: optionalIsoDate(formValue(values, "item-expiry-date")),
			lowStockThreshold: threshold
				? nonNegativeInteger(threshold, "在庫不足しきい値")
				: undefined,
			memo: formValue(values, "item-memo") || undefined,
		};
		if (includeDefinition) {
			input.baseUnit = formValue(values, "item-base-unit");
			input.baseDimension = formValue(
				values,
				"item-base-dimension",
			) as ItemInput["baseDimension"];
		}
		if (includeStock) {
			input.currentQuantity = nonNegativeInteger(
				formValue(values, "item-current-quantity"),
				"現在庫数",
			);
		}
		return input;
	};

	const createItem = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		setItemError(null);
		setNotice(null);
		setItemSubmitting(true);
		try {
			await request("/api/items", {
				method: "POST",
				body: JSON.stringify(itemInput(new FormData(form))),
			});
			form.reset();
			setNotice("商品を追加しました。");
			await refreshItems();
		} catch (error) {
			setItemError(
				error instanceof Error
					? error.message
					: "商品を追加できませんでした。入力内容を確認してください。",
			);
		} finally {
			setItemSubmitting(false);
		}
	};

	const updateItem = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!editingItem) {
			return;
		}
		setItemError(null);
		setNotice(null);
		setItemSubmitting(true);
		try {
			const values = new FormData(event.currentTarget);
			const input = itemInput(values, {
				includeStock: false,
				includeDefinition: false,
			});
			await request(`/api/items/${encodeURIComponent(editingItem.id)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			});
			setEditingItem(null);
			setNotice("商品を更新しました。");
			await refreshItems();
		} catch (error) {
			setItemError(
				error instanceof Error
					? error.message
					: "商品を更新できませんでした。入力内容を確認してください。",
			);
		} finally {
			setItemSubmitting(false);
		}
	};

	const deleteItem = async (item: Item) => {
		if (
			!window.confirm(
				`「${item.name}」を削除します。この操作は取り消せません。`,
			)
		) {
			return;
		}
		setItemError(null);
		setNotice(null);
		setItemSubmitting(true);
		try {
			await request(`/api/items/${encodeURIComponent(item.id)}`, {
				method: "DELETE",
			});
			if (editingItem?.id === item.id) {
				setEditingItem(null);
			}
			setNotice("商品を削除しました。");
			await refreshItems();
		} catch (error) {
			setItemError(
				error instanceof Error
					? error.message
					: "商品を削除できませんでした。関連する在庫情報を確認してください。",
			);
		} finally {
			setItemSubmitting(false);
		}
	};

	return (
		<main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-10 lg:py-10">
			<div className="mx-auto max-w-7xl">
				<header className="border-b border-slate-300 pb-6 sm:flex sm:items-end sm:justify-between">
					<div>
						<p className="text-sm font-semibold tracking-[0.16em] text-indigo-700 uppercase">
							Inventia
						</p>
						<h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
							在庫管理
						</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
							保管場所と商品を登録し、現在の保管先を確認できます。
						</p>
					</div>
					<Button
						variant="secondary"
						className="mt-5 sm:mt-0"
						onPress={() => {
							void refreshLocations();
							void refreshItems();
						}}
					>
						一覧を再読み込み
					</Button>
				</header>

				{notice ? (
					<output
						aria-live="polite"
						className="mt-6 border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
					>
						{notice}
					</output>
				) : null}

				<div className="mt-8 grid gap-8 xl:grid-cols-2">
					<section aria-labelledby="locations-heading" className="min-w-0">
						<div className="flex items-baseline justify-between gap-4">
							<div>
								<p className="text-sm font-semibold text-indigo-700">01</p>
								<h2 id="locations-heading" className="mt-1 text-2xl font-bold">
									場所
								</h2>
							</div>
							<p className="text-sm text-slate-600">{locations.length} 件</p>
						</div>

						<form
							onSubmit={(event) => void createLocation(event)}
							className="mt-5 border-t-2 border-slate-950 pt-5"
						>
							<h3 className="text-base font-bold">場所を追加</h3>
							<div className="mt-4 grid gap-4 sm:grid-cols-2">
								<label className={labelClassName}>
									場所名 <span className="text-rose-700">必須</span>
									<input
										name="location-name"
										required
										maxLength={200}
										autoComplete="off"
										className={fieldClassName}
									/>
								</label>
								<label className={labelClassName}>
									親の場所
									<select name="location-parent" className={fieldClassName}>
										<option value="">最上位の場所</option>
										{locations.map((location) => (
											<option key={location.id} value={location.id}>
												{location.name}
											</option>
										))}
									</select>
								</label>
								<label className={labelClassName}>
									並び順
									<input
										name="location-sort-order"
										type="number"
										inputMode="numeric"
										step="1"
										defaultValue="0"
										className={fieldClassName}
									/>
									<span className={helpClassName}>
										小さい数値から順に表示します。
									</span>
								</label>
							</div>
							{locationError ? (
								<p
									role="alert"
									className="mt-4 border-l-4 border-rose-700 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950"
								>
									{locationError}
								</p>
							) : null}
							<div className="mt-5">
								<Button type="submit" isDisabled={locationSubmitting}>
									{locationSubmitting ? "保存中…" : "場所を追加"}
								</Button>
							</div>
						</form>

						{editingLocation ? (
							<form
								key={editingLocation.id}
								onSubmit={(event) => void updateLocation(event)}
								className="mt-6 border-t border-slate-300 pt-5"
							>
								<div className="flex items-center justify-between gap-4">
									<h3 className="text-base font-bold">場所を編集</h3>
									<Button
										type="button"
										variant="secondary"
										onPress={() => setEditingLocation(null)}
									>
										閉じる
									</Button>
								</div>
								<div className="mt-4 grid gap-4 sm:grid-cols-2">
									<label className={labelClassName}>
										場所名 <span className="text-rose-700">必須</span>
										<input
											name="edit-location-name"
											required
											maxLength={200}
											defaultValue={editingLocation.name}
											className={fieldClassName}
										/>
									</label>
									<label className={labelClassName}>
										親の場所
										<select
											name="edit-location-parent"
											defaultValue={editingLocation.parentId ?? ""}
											className={fieldClassName}
										>
											<option value="">最上位の場所</option>
											{locations
												.filter(
													(location) => location.id !== editingLocation.id,
												)
												.map((location) => (
													<option key={location.id} value={location.id}>
														{location.name}
													</option>
												))}
										</select>
									</label>
									<label className={labelClassName}>
										並び順
										<input
											name="edit-location-sort-order"
											type="number"
											inputMode="numeric"
											step="1"
											required
											defaultValue={editingLocation.sortOrder}
											className={fieldClassName}
										/>
									</label>
								</div>
								<div className="mt-5 flex flex-wrap gap-3">
									<Button type="submit" isDisabled={locationSubmitting}>
										{locationSubmitting ? "更新中…" : "変更を保存"}
									</Button>
								</div>
							</form>
						) : null}

						<div className="mt-7 border-t border-slate-300 pt-5">
							<h3 className="text-base font-bold">登録済みの場所</h3>
							{locationsLoading ? (
								<output className="mt-4 text-sm text-slate-600">
									場所を読み込んでいます…
								</output>
							) : (
								<ul className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
									{locations.map((location) => (
										<li
											key={location.id}
											className="flex flex-wrap items-center justify-between gap-3 py-3"
										>
											<div className="min-w-0">
												<p className="truncate font-semibold">
													{location.name}
												</p>
												<p className="mt-1 text-xs text-slate-600">
													{location.parentId
														? `親: ${locationNames.get(location.parentId) ?? location.parentId}`
														: "最上位の場所"}
													{" · "}並び順 {location.sortOrder}
												</p>
											</div>
											<div className="flex shrink-0 gap-2">
												<Button
													type="button"
													variant="secondary"
													onPress={() => setEditingLocation(location)}
												>
													編集
												</Button>
												<Button
													type="button"
													variant="secondary"
													isDisabled={locationSubmitting}
													onPress={() => void deleteLocation(location)}
												>
													削除
												</Button>
											</div>
										</li>
									))}
								</ul>
							)}
						</div>
					</section>

					<section aria-labelledby="items-heading" className="min-w-0">
						<div className="flex items-baseline justify-between gap-4">
							<div>
								<p className="text-sm font-semibold text-indigo-700">02</p>
								<h2 id="items-heading" className="mt-1 text-2xl font-bold">
									商品
								</h2>
							</div>
							<p className="text-sm text-slate-600">{items.length} 件</p>
						</div>

						<form
							onSubmit={(event) => void createItem(event)}
							className="mt-5 border-t-2 border-slate-950 pt-5"
						>
							<h3 className="text-base font-bold">商品を追加</h3>
							<ItemFields
								locations={locations}
								disabled={
									itemSubmitting || locationsLoading || locations.length === 0
								}
								idPrefix="new-item"
							/>
							{locations.length === 0 ? (
								<p className="mt-4 text-sm leading-6 text-slate-600">
									商品を追加する前に、保管場所を1件以上追加してください。
								</p>
							) : null}
							{itemError ? (
								<p
									role="alert"
									className="mt-4 border-l-4 border-rose-700 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-950"
								>
									{itemError}
								</p>
							) : null}
							<div className="mt-5">
								<Button
									type="submit"
									isDisabled={
										itemSubmitting || locationsLoading || locations.length === 0
									}
								>
									{itemSubmitting ? "保存中…" : "商品を追加"}
								</Button>
							</div>
						</form>

						{editingItem ? (
							<form
								key={editingItem.id}
								onSubmit={(event) => void updateItem(event)}
								className="mt-6 border-t border-slate-300 pt-5"
							>
								<div className="flex items-center justify-between gap-4">
									<h3 className="text-base font-bold">商品を編集</h3>
									<Button
										type="button"
										variant="secondary"
										onPress={() => setEditingItem(null)}
									>
										閉じる
									</Button>
								</div>
								<ItemFields
									locations={locations}
									disabled={itemSubmitting}
									item={editingItem}
									idPrefix="edit-item"
								/>
								<div className="mt-5">
									<Button type="submit" isDisabled={itemSubmitting}>
										{itemSubmitting ? "更新中…" : "変更を保存"}
									</Button>
								</div>
							</form>
						) : null}

						<div className="mt-7 border-t border-slate-300 pt-5">
							<h3 className="text-base font-bold">登録済みの商品</h3>
							{itemsLoading ? (
								<output className="mt-4 text-sm text-slate-600">
									商品を読み込んでいます…
								</output>
							) : (
								<ul className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
									{items.map((item) => (
										<li key={item.id} className="py-4">
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="truncate font-semibold">{item.name}</p>
													<p className="mt-1 text-sm text-slate-700">
														{item.currentQuantity} {item.baseUnit}
														{" · "}
														{locationNames.get(item.locationId) ??
															item.locationId}
													</p>
													<p className="mt-1 text-xs leading-5 text-slate-600">
														カテゴリ: {item.categoryId}
														{item.lowStockThreshold !== null
															? ` · しきい値: ${item.lowStockThreshold}`
															: ""}
														{item.expiryDate
															? ` · 期限: ${item.expiryDate.slice(0, 10)}`
															: ""}
													</p>
												</div>
												<div className="flex shrink-0 gap-2">
													<Button
														type="button"
														variant="secondary"
														onPress={() => setEditingItem(item)}
													>
														編集
													</Button>
													<Button
														type="button"
														variant="secondary"
														isDisabled={itemSubmitting}
														onPress={() => void deleteItem(item)}
													>
														削除
													</Button>
												</div>
											</div>
										</li>
									))}
								</ul>
							)}
						</div>
					</section>
				</div>
			</div>
		</main>
	);
}

function ItemFields({
	locations,
	disabled,
	item,
	idPrefix,
}: {
	locations: Location[];
	disabled: boolean;
	item?: Item;
	idPrefix: string;
}) {
	return (
		<div className="mt-4 grid gap-4 sm:grid-cols-2">
			<label className={labelClassName}>
				商品名 <span className="text-rose-700">必須</span>
				<input
					name="item-name"
					required
					maxLength={200}
					disabled={disabled}
					defaultValue={item?.name}
					className={fieldClassName}
				/>
			</label>
			<label className={labelClassName}>
				カテゴリID <span className="text-rose-700">必須</span>
				<input
					name="item-category-id"
					required
					disabled={disabled}
					autoComplete="off"
					defaultValue={item?.categoryId}
					className={fieldClassName}
					aria-describedby={`${idPrefix}-category-id-help`}
				/>
				<span id={`${idPrefix}-category-id-help`} className={helpClassName}>
					登録済みseedカテゴリのIDを入力してください。
				</span>
			</label>
			<label className={labelClassName}>
				保管場所 <span className="text-rose-700">必須</span>
				<select
					name="item-location-id"
					required
					disabled={disabled}
					defaultValue={item?.locationId ?? ""}
					className={fieldClassName}
				>
					<option value="" disabled>
						場所を選択
					</option>
					{locations.map((location) => (
						<option key={location.id} value={location.id}>
							{location.name}
						</option>
					))}
				</select>
			</label>
			<label className={labelClassName}>
				基準単位 <span className="text-rose-700">必須</span>
				<input
					name="item-base-unit"
					required
					maxLength={50}
					disabled={disabled}
					autoComplete="off"
					defaultValue={item?.baseUnit}
					className={fieldClassName}
				/>
			</label>
			<label className={labelClassName}>
				単位の種類 <span className="text-rose-700">必須</span>
				<select
					name="item-base-dimension"
					required
					disabled={disabled}
					defaultValue={item?.baseDimension ?? ""}
					className={fieldClassName}
				>
					<option value="" disabled>
						種類を選択
					</option>
					<option value="count">個数</option>
					<option value="mass">重量</option>
					<option value="volume">容量</option>
				</select>
			</label>
			<label className={labelClassName}>
				現在庫数 <span className="text-rose-700">必須</span>
				<input
					name="item-current-quantity"
					type="number"
					inputMode="numeric"
					min="0"
					step="1"
					required
					disabled={disabled}
					defaultValue={item?.currentQuantity ?? 0}
					className={fieldClassName}
				/>
			</label>
			<label className={labelClassName}>
				消費・使用期限
				<input
					name="item-expiry-date"
					type="date"
					disabled={disabled}
					defaultValue={item?.expiryDate?.slice(0, 10) ?? ""}
					className={fieldClassName}
				/>
			</label>
			<label className={labelClassName}>
				在庫不足しきい値
				<input
					name="item-low-stock-threshold"
					type="number"
					inputMode="numeric"
					min="0"
					step="1"
					disabled={disabled}
					defaultValue={item?.lowStockThreshold ?? ""}
					className={fieldClassName}
				/>
			</label>
			<label className={`${labelClassName} sm:col-span-2`}>
				メモ
				<textarea
					name="item-memo"
					maxLength={2000}
					disabled={disabled}
					defaultValue={item?.memo ?? ""}
					className={`${fieldClassName} min-h-24 resize-y`}
				/>
			</label>
		</div>
	);
}
