import { atom } from "jotai";
import type { ExternalProviderDto } from "@/domain/externalProvider";

type ProviderFormState = {
    name: string;
    /** ファビコンは画像を保管せず URL だけを持つ。空文字は「未設定」。 */
    faviconUrl: string;
    url: string;
};

const emptyForm: ProviderFormState = {
    name: "",
    faviconUrl: "",
    url: "",
};

const formStateOf = (target: ExternalProviderDto | null): ProviderFormState =>
    target
        ? {
              name: target.name,
              faviconUrl: target.faviconUrl ?? "",
              url: target.url ?? "",
          }
        : emptyForm;

export const providerQueryAtom = atom("");
export const editingProviderAtom = atom<ExternalProviderDto | null>(null);
export const providerFormAtom = atom<ProviderFormState>(emptyForm);
export const providerFormSavingAtom = atom(false);
/** 入力欄を切り替えるたびに増える連番。保存完了時の初期化の要否判定に使う。 */
export const providerFormGenerationAtom = atom(0);

/**
 * 編集対象と入力欄を同時に切り替える。null を渡すと新規登録の初期状態に戻る。
 * 入力欄の初期化を effect ではなく操作の一部にして、編集中に別の操作を始めても
 * 後追いの初期化で入力内容が上書きされないようにする。
 */
export const startProviderEditAtom = atom(
    null,
    (get, set, target: ExternalProviderDto | null) => {
        set(editingProviderAtom, target);
        set(providerFormAtom, formStateOf(target));
        set(providerFormGenerationAtom, get(providerFormGenerationAtom) + 1);
    },
);

/**
 * 保存完了後に入力欄を新規登録の初期状態へ戻す。保存を待つ間に別の行を選び
 * 直していた場合は連番が進んでいるので、その入力内容を消さずに何もしない。
 */
export const finishProviderSaveAtom = atom(
    null,
    (get, set, generation: number) => {
        if (get(providerFormGenerationAtom) !== generation) return;
        set(editingProviderAtom, null);
        set(providerFormAtom, emptyForm);
        set(providerFormGenerationAtom, generation + 1);
    },
);
