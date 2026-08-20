import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { StoreDto } from "@/domain/store";
import {
    createStore,
    deleteStore,
    deleteStoreFavicon,
    updateStore,
    uploadStoreFavicon,
} from "../-api/store-api";
import { storeKeys } from "../-api/store-queries";
import { editingStoreAtom } from "./store-atoms";
import { StoreForm, type StoreSaveInput } from "./store-form";
import { StoreTable } from "./store-table";

export function StoreMasterPage({ stores }: { stores: StoreDto[] }) {
    const queryClient = useQueryClient();
    const editing = useAtomValue(editingStoreAtom);
    const [error, setError] = useState<string | null>(null);
    // onSettled の Promise を返すと mutateAsync が再取得完了まで待つ。
    // 画像の保存だけが失敗しても一覧は流す。新規登録の直後に失敗したとき、
    // 一覧に出ない店舗が残ると再登録が STORE_NAME_CONFLICT になるため
    const invalidateStores = () =>
        queryClient.invalidateQueries({ queryKey: storeKeys.all });
    const saveMutation = useMutation({
        // 新規登録時のファビコンは「作成 → その id へ PUT」の 2 段で保存する
        mutationFn: async (input: StoreSaveInput) => {
            const saved = editing
                ? await updateStore(editing.id, {
                      name: input.name,
                      url: input.url,
                  })
                : await createStore({ name: input.name, url: input.url });
            if (input.faviconFile !== null) {
                return uploadStoreFavicon(saved.id, input.faviconFile);
            }
            if (input.removeFavicon && saved.faviconUrl !== null) {
                return deleteStoreFavicon(saved.id);
            }
            return saved;
        },
        onSettled: invalidateStores,
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteStore(id),
        onSuccess: invalidateStores,
    });
    const save = async (input: StoreSaveInput) => {
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
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">店舗マスタ</h1>
            </header>
            {error ? (
                <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </p>
            ) : null}
            <StoreForm onSave={save} />
            <StoreTable stores={stores} onDelete={remove} />
        </main>
    );
}
