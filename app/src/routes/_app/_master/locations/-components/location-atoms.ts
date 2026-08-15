import { atom } from "jotai";
import type { LocationDto } from "@/domain/location";

type LocationFormState = {
    name: string;
    parentId: string | null;
    sortOrder: string;
};

export const locationQueryAtom = atom("");
export const expandedLocationIdsAtom = atom<Set<string>>(new Set<string>());
export const editingLocationAtom = atom<LocationDto | null>(null);
export const locationFormAtom = atom<LocationFormState>({
    name: "",
    parentId: null,
    sortOrder: "0",
});
export const locationFormSavingAtom = atom(false);
