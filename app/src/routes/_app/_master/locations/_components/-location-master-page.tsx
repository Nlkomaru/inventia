import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect } from "react";
import {
	createLocation,
	deleteLocation,
	listLocationTree,
	updateLocation,
} from "./-location-api";
import {
	editingLocationAtom,
	locationsAtom,
	locationsErrorAtom,
	locationsLoadingAtom,
} from "./-location-atoms";
import { LocationForm } from "./-location-form";
import { LocationTable } from "./-location-table";

export function LocationMasterPage() {
	const [locations, setLocations] = useAtom(locationsAtom);
	const editing = useAtomValue(editingLocationAtom);
	const [loading, setLoading] = useAtom(locationsLoadingAtom);
	const [error, setError] = useAtom(locationsErrorAtom);
	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setLocations(await listLocationTree());
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "保管場所を取得できませんでした",
			);
		} finally {
			setLoading(false);
		}
	}, [setError, setLoading, setLocations]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const save = async (input: {
		name: string;
		parentId: string | null;
		sortOrder: number;
	}) => {
		setError(null);
		try {
			if (editing) await updateLocation(editing.id, input);
			else await createLocation(input);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "保存できませんでした");
			throw cause;
		}
	};
	const remove = async (id: string) => {
		setError(null);
		try {
			await deleteLocation(id);
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "削除できませんでした");
		}
	};
	return (
		<main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
			<header>
				<p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-500">
					Master data
				</p>
				<h1 className="mt-1 text-2xl font-bold">保管場所マスタ</h1>
				<p className="mt-2 text-sm text-slate-500">
					建物から棚まで、在庫の保管場所を階層で整理します。
				</p>
			</header>
			{error ? (
				<p
					role="alert"
					className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
				>
					{error}
				</p>
			) : null}
			<LocationForm onSave={save} />
			{loading && locations.length === 0 ? (
				<p className="p-8 text-center text-slate-500">読み込み中…</p>
			) : (
				<LocationTable onDelete={remove} />
			)}
		</main>
	);
}
