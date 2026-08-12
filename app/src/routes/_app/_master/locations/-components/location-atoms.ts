import { atom } from "jotai";
import type { LocationDto } from "@/domain/location";

export const locationsAtom = atom<LocationDto[]>([]);
export const locationsLoadingAtom = atom(true);
export const locationsErrorAtom = atom<string | null>(null);
export const locationQueryAtom = atom("");
export const expandedLocationIdsAtom = atom<Set<string>>(new Set());
export const editingLocationAtom = atom<LocationDto | null>(null);
