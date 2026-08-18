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
/** 入力欄を切り替えるたびに増える連番。保存完了時の初期化の要否判定に使う。 */
export const locationFormGenerationAtom = atom(0);

/**
 * 編集対象と入力欄を同時に切り替える。null を渡すと新規登録の初期状態に戻る。
 * 入力欄の初期化を effect ではなく操作の一部にして、編集中に別の操作を始めても
 * 後追いの初期化で入力内容が上書きされないようにする。
 */
export const startLocationEditAtom = atom(
    null,
    (get, set, target: LocationDto | null) => {
        set(editingLocationAtom, target);
        set(locationFormAtom, formStateOf(target));
        set(locationFormGenerationAtom, get(locationFormGenerationAtom) + 1);
    },
);

/** 指定した場所を親にした新規登録を始める。 */
export const startLocationChildAtom = atom(
    null,
    (get, set, parent: LocationDto) => {
        set(editingLocationAtom, null);
        set(locationFormAtom, { ...emptyForm, parentId: parent.id });
        set(locationFormGenerationAtom, get(locationFormGenerationAtom) + 1);
    },
);

/**
 * 保存完了後に入力欄を新規登録の初期状態へ戻す。保存を待つ間に別の行を選び
 * 直していた場合は連番が進んでいるので、その入力内容を消さずに何もしない。
 */
export const finishLocationSaveAtom = atom(
    null,
    (get, set, generation: number) => {
        if (get(locationFormGenerationAtom) !== generation) return;
        set(editingLocationAtom, null);
        set(locationFormAtom, emptyForm);
        set(locationFormGenerationAtom, generation + 1);
    },
);
