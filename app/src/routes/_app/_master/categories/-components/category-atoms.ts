import { atom } from "jotai";
import type { CategoryKind } from "@/domain/category";

export type CategoryFormState = {
    name: string;
    parentId: string | null;
    kind: CategoryKind | null;
    sortOrder: string;
};

export const initialCategoryFormState: CategoryFormState = {
    name: "",
    parentId: null,
    kind: null,
    sortOrder: "0",
};

export const categoryQueryAtom = atom("");
export const expandedCategoryIdsAtom = atom<ReadonlySet<string>>(
    new Set<string>(),
);
// サーバー由来の DTO を持たず、編集対象は ID だけを保持する
export const editingCategoryIdAtom = atom<string | null>(null);
export const categoryFormAtom = atom<CategoryFormState>(
    initialCategoryFormState,
);
export const categoryFormSavingAtom = atom(false);
