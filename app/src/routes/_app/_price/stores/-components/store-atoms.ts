import { atom } from "jotai";
import type { StoreDto } from "@/domain/store";

type StoreFormState = {
    name: string;
    url: string;
    /** 新しく選ばれたファビコン画像。null なら画像を差し替えない。 */
    faviconFile: File | null;
    /** 既存のファビコンを削除する。新しい画像を選ぶと解除される。 */
    faviconRemoved: boolean;
};

const emptyForm: StoreFormState = {
    name: "",
    url: "",
    faviconFile: null,
    faviconRemoved: false,
};

const formStateOf = (target: StoreDto | null): StoreFormState =>
    target
        ? {
              name: target.name,
              url: target.url ?? "",
              faviconFile: null,
              faviconRemoved: false,
          }
        : emptyForm;

export const storeQueryAtom = atom("");
export const editingStoreAtom = atom<StoreDto | null>(null);
export const storeFormAtom = atom<StoreFormState>(emptyForm);
export const storeFormSavingAtom = atom(false);
/** 選んだ画像が受け付けられなかった理由。null なら送信できる。 */
export const storeFaviconErrorAtom = atom<string | null>(null);
/** 入力欄を切り替えるたびに増える連番。保存完了時の初期化の要否判定に使う。 */
export const storeFormGenerationAtom = atom(0);

/**
 * 編集対象と入力欄を同時に切り替える。null を渡すと新規登録の初期状態に戻る。
 * 入力欄の初期化を effect ではなく操作の一部にして、編集中に別の操作を始めても
 * 後追いの初期化で入力内容が上書きされないようにする。
 */
export const startStoreEditAtom = atom(
    null,
    (get, set, target: StoreDto | null) => {
        set(editingStoreAtom, target);
        set(storeFormAtom, formStateOf(target));
        set(storeFaviconErrorAtom, null);
        set(storeFormGenerationAtom, get(storeFormGenerationAtom) + 1);
    },
);

/**
 * 保存完了後に入力欄を新規登録の初期状態へ戻す。保存を待つ間に別の行を選び
 * 直していた場合は連番が進んでいるので、その入力内容を消さずに何もしない。
 */
export const finishStoreSaveAtom = atom(
    null,
    (get, set, generation: number) => {
        if (get(storeFormGenerationAtom) !== generation) return;
        set(editingStoreAtom, null);
        set(storeFormAtom, emptyForm);
        set(storeFaviconErrorAtom, null);
        set(storeFormGenerationAtom, generation + 1);
    },
);
