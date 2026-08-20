import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { LocationDto } from "@/domain/location";
import {
    createLocation,
    deleteLocation,
    updateLocation,
} from "../-api/location-api";
import { locationKeys } from "../-api/location-queries";
import { editingLocationAtom } from "./location-atoms";
import { LocationForm } from "./location-form";
import { LocationTable } from "./location-table";

type LocationSaveInput = {
    name: string;
    parentId: string | null;
    sortOrder: number;
};

export function LocationMasterPage({
    locations,
    itemCounts,
}: {
    locations: LocationDto[];
    itemCounts: Record<string, number>;
}) {
    const queryClient = useQueryClient();
    const editing = useAtomValue(editingLocationAtom);
    const [error, setError] = useState<string | null>(null);
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const invalidateLocations = () =>
        queryClient.invalidateQueries({ queryKey: locationKeys.all });
    const saveMutation = useMutation({
        mutationFn: (input: LocationSaveInput) =>
            editing ? updateLocation(editing.id, input) : createLocation(input),
        onSuccess: invalidateLocations,
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteLocation(id),
        onSuccess: invalidateLocations,
    });
    const save = async (input: LocationSaveInput) => {
        setError(null);
        try {
            await saveMutation.mutateAsync(input);
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
            await deleteMutation.mutateAsync(id);
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "削除できませんでした",
            );
        }
    };
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">保管場所マスタ</h1>
            </header>
            {error ? (
                <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </p>
            ) : null}
            <LocationForm locations={locations} onSave={save} />
            <LocationTable
                locations={locations}
                itemCounts={itemCounts}
                onDelete={remove}
            />
        </main>
    );
}
