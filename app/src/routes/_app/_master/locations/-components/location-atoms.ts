import { atom } from "jotai";
import type { LocationDto } from "@/domain/location";

type LocationFormState = {
    name: string;
    parentId: string | null;
    sortOrder: string;
};

const emptyForm: LocationFormState = {
    name: "",
    parentId: null,
    sortOrder: "0",
};

const formStateOf = (target: LocationDto | null): LocationFormState =>
    target
        ? {
              name: target.name,
              parentId: target.parentId,
              sortOrder: String(target.sortOrder),
          }
        : emptyForm;

export const locationQueryAtom = atom("");
export const expandedLocationIdsAtom = atom<Set<string>>(new Set<string>());
export const editingLocationAtom = atom<LocationDto | null>(null);
export const locationFormAtom = atom<LocationFormState>(emptyForm);
export const locationFormSavingAtom = atom(false);

/**
 * 編集対象と入力欄を同時に切り替える。null を渡すと新規登録の初期状態に戻る。
 * 入力欄の初期化を effect ではなく操作の一部にして、編集中に別の操作を始めても
 * 後追いの初期化で入力内容が上書きされないようにする。
 */
export const startLocationEditAtom = atom(
    null,
    (_get, set, target: LocationDto | null) => {
        set(editingLocationAtom, target);
        set(locationFormAtom, formStateOf(target));
    },
);

/** 指定した場所を親にした新規登録を始める。 */
export const startLocationChildAtom = atom(
    null,
    (_get, set, parent: LocationDto) => {
        set(editingLocationAtom, null);
        set(locationFormAtom, { ...emptyForm, parentId: parent.id });
    },
);
