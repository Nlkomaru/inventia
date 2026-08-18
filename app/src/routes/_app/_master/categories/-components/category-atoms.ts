import { atom } from "jotai";
import type { CategoryDto, CategoryKind } from "@/domain/category";

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

const formStateOf = (target: CategoryDto | null): CategoryFormState =>
    target
        ? {
              name: target.name,
              parentId: target.parentId,
              kind: target.kind,
              sortOrder: String(target.sortOrder),
          }
        : initialCategoryFormState;

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
/** 入力欄を切り替えるたびに増える連番。保存完了時の初期化の要否判定に使う。 */
export const categoryFormGenerationAtom = atom(0);

/**
 * 編集対象と入力欄を同時に切り替える。null を渡すと新規登録の初期状態に戻る。
 * 入力欄の初期化を effect ではなく操作の一部にして、編集中に別の操作を始めても
 * 後追いの初期化で入力内容が上書きされないようにする。
 */
export const startCategoryEditAtom = atom(
    null,
    (get, set, target: CategoryDto | null) => {
        set(editingCategoryIdAtom, target?.id ?? null);
        set(categoryFormAtom, formStateOf(target));
        set(categoryFormGenerationAtom, get(categoryFormGenerationAtom) + 1);
    },
);

/** 指定したカテゴリを親にした新規登録を始める。 */
export const startCategoryChildAtom = atom(
    null,
    (get, set, parent: CategoryDto) => {
        set(editingCategoryIdAtom, null);
        set(categoryFormAtom, {
            ...initialCategoryFormState,
            parentId: parent.id,
        });
        set(categoryFormGenerationAtom, get(categoryFormGenerationAtom) + 1);
    },
);

/**
 * 保存完了後に入力欄を新規登録の初期状態へ戻す。保存を待つ間に別の行を選び
 * 直していた場合は連番が進んでいるので、その入力内容を消さずに何もしない。
 */
export const finishCategorySaveAtom = atom(
    null,
    (get, set, generation: number) => {
        if (get(categoryFormGenerationAtom) !== generation) return;
        set(editingCategoryIdAtom, null);
        set(categoryFormAtom, initialCategoryFormState);
        set(categoryFormGenerationAtom, generation + 1);
    },
);
