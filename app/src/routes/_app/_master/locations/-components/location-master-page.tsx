import { useRouter } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { LocationDto } from "@/domain/location";
import { createLocation, deleteLocation, updateLocation } from "./location-api";
import { editingLocationAtom } from "./location-atoms";
import { LocationForm } from "./location-form";
import { LocationTable } from "./location-table";

export function LocationMasterPage({
    locations,
}: {
    locations: LocationDto[];
}) {
    const router = useRouter();
    const editing = useAtomValue(editingLocationAtom);
    const [error, setError] = useState<string | null>(null);
    const save = async (input: {
        name: string;
        parentId: string | null;
        sortOrder: number;
    }) => {
        setError(null);
        try {
            if (editing) await updateLocation(editing.id, input);
            else await createLocation(input);
            await router.invalidate();
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "保存できませんでした",
            );
            throw cause;
        }
    };
    const remove = async (id: string) => {
        setError(null);
        try {
            await deleteLocation(id);
            await router.invalidate();
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "削除できませんでした",
            );
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
            <LocationForm locations={locations} onSave={save} />
            <LocationTable locations={locations} onDelete={remove} />
        </main>
    );
}
