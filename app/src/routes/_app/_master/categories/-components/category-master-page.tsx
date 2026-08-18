import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import type { CategoryDto, CategoryKind } from "@/domain/category";
import {
    createCategory,
    deleteCategory,
    updateCategory,
} from "../-api/category-api";
import { categoryKeys } from "../-api/category-queries";
import {
    categoryFormSavingAtom,
    categoryQueryAtom,
    editingCategoryIdAtom,
    expandedCategoryIdsAtom,
    startCategoryEditAtom,
} from "./category-atoms";
import { CategoryForm } from "./category-form";
import { CategoryTable } from "./category-table";

type CategorySaveInput = {
    name: string;
    parentId: string | null;
    kind: CategoryKind | null;
    sortOrder: number;
};

export function CategoryMasterPage({
    categories,
    truncated = false,
}: {
    categories: CategoryDto[];
    /** 一括取得の上限で打ち切られた場合に true。 */
    truncated?: boolean;
}) {
    const queryClient = useQueryClient();
    const editingId = useAtomValue(editingCategoryIdAtom);
    const resetEdit = useSetAtom(startCategoryEditAtom);
    const setSaving = useSetAtom(categoryFormSavingAtom);
    const setQuery = useSetAtom(categoryQueryAtom);
    const setExpanded = useSetAtom(expandedCategoryIdsAtom);
    const [error, setError] = useState<string | null>(null);
    // atom はモジュールスコープに残るため、画面を離れるときに編集状態を破棄する
    useEffect(
        () => () => {
            resetEdit(null);
            setSaving(false);
            setQuery("");
            setExpanded(new Set<string>());
        },
        [resetEdit, setExpanded, setQuery, setSaving],
    );
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const invalidateCategories = () =>
        queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    const saveMutation = useMutation({
        mutationFn: (input: CategorySaveInput) =>
            editingId === null
                ? createCategory(input)
                : updateCategory(editingId, input),
        onSuccess: invalidateCategories,
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteCategory(id),
        onSuccess: invalidateCategories,
    });
    const { mutateAsync: saveCategory } = saveMutation;
    const { mutateAsync: removeCategory } = deleteMutation;
    // フォームと data table のセルへ渡すハンドラ。参照が変わるとセルが再マウントされ、
    // 操作直後のフォーカスが外れるため useCallback で固定する
    const save = useCallback(
        async (input: CategorySaveInput) => {
            setError(null);
            try {
                await saveCategory(input);
            } catch (cause) {
                setError(
                    cause instanceof Error
                        ? cause.message
                        : "保存できませんでした",
                );
                throw cause;
            }
        },
        [saveCategory],
    );
    const remove = useCallback(
        async (id: string) => {
            setError(null);
            try {
                await removeCategory(id);
            } catch (cause) {
                setError(
                    cause instanceof Error
                        ? cause.message
                        : "削除できませんでした",
                );
            }
        },
        [removeCategory],
    );
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">カテゴリマスタ</h1>
            </header>
            {truncated ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                    カテゴリが多いため、表示は先頭 {categories.length}{" "}
                    件までに絞り込んでいます。
                </p>
            ) : null}
            {error ? (
                <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </p>
            ) : null}
            <CategoryForm categories={categories} onSave={save} />
            <CategoryTable categories={categories} onDelete={remove} />
        </main>
    );
}
