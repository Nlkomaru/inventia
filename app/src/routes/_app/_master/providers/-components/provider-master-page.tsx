import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { ExternalProviderDto } from "@/domain/externalProvider";
import {
    createProvider,
    deleteProvider,
    updateProvider,
} from "../-api/provider-api";
import { providerKeys } from "../-api/provider-queries";
import { editingProviderAtom } from "./provider-atoms";
import { ProviderForm, type ProviderSaveInput } from "./provider-form";
import { ProviderTable } from "./provider-table";

export function ProviderMasterPage({
    providers,
}: {
    providers: ExternalProviderDto[];
}) {
    const queryClient = useQueryClient();
    const editing = useAtomValue(editingProviderAtom);
    const [error, setError] = useState<string | null>(null);
    const invalidateProviders = () =>
        queryClient.invalidateQueries({ queryKey: providerKeys.all });
    // 編集では 3 項目すべてを送る。空欄は null として送るので、入力欄で消した
    // URL がそのまま消去になる
    const saveMutation = useMutation({
        mutationFn: (input: ProviderSaveInput) =>
            editing ? updateProvider(editing.id, input) : createProvider(input),
        onSuccess: invalidateProviders,
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteProvider(id),
        onSuccess: invalidateProviders,
    });
    const save = async (input: ProviderSaveInput) => {
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
                <h1 className="mt-1 text-2xl font-bold">外部連携先マスタ</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    在庫の使用を紐付ける外部アプリを登録します。
                </p>
            </header>
            {error ? (
                <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </p>
            ) : null}
            <ProviderForm onSave={save} />
            <ProviderTable providers={providers} onDelete={remove} />
        </main>
    );
}
