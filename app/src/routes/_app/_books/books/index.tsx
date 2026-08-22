import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { BookReadingItemDto } from "@/domain/item";
import {
    type ReadingStateUpsertInput,
    readingStatuses,
} from "@/domain/reading";
import {
    type ReadingStateChange,
    readingStatusLabels,
} from "@/lib/reading-input";
import { clearReadingState, setReadingState } from "./-api/book-api";
import {
    bookKeys,
    bookReadingListQueryOptions,
    inventoryKeys,
    itemKeys,
} from "./-api/book-queries";
import { BookTable } from "./-components/book-table";
import { ReadingStateSheet } from "./-components/reading-state-sheet";

// 読書状態の絞り込み。`none` は読書状態が未設定の書籍
type StatusFilter = "all" | (typeof readingStatuses)[number] | "none";

const statusFilterItems: { label: string; value: StatusFilter }[] = [
    { label: "すべての読書状態", value: "all" },
    ...readingStatuses.map((status) => ({
        label: readingStatusLabels[status],
        value: status as StatusFilter,
    })),
    { label: "未設定", value: "none" },
];

const isStatusFilter = (value: string): value is StatusFilter =>
    statusFilterItems.some((option) => option.value === value);

// 絞り込みは URL の search params に持たせて共有・再訪時に同じ状態へ戻す。
// 既定値を schema に持たせると /books が正規化 URL へ redirect されるため、
// 未指定は optional のままにし、不正値は catch で未指定へ寄せる
const bookSearchSchema = z.object({
    status: z
        .enum([...readingStatuses, "none"])
        .optional()
        .catch(undefined),
});

export const Route = createFileRoute("/_app/_books/books/")({
    validateSearch: bookSearchSchema,
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(bookReadingListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "読書一覧" }],
    },
    component: BooksPage,
    pendingComponent: BooksPending,
    errorComponent: BooksError,
});

const pageClassName = "w-full space-y-6 p-4 sm:p-6 lg:p-8";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

function BooksPage() {
    const { data: books } = useSuspenseQuery(bookReadingListQueryOptions());
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const queryClient = useQueryClient();
    const [query, setQuery] = useState("");
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editingBook, setEditingBook] = useState<BookReadingItemDto | null>(
        null,
    );

    // 読書状態は品目一覧の readingStatus 列と在庫一覧の行にも出るため併せて無効化する。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ
    const invalidateBooks = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: bookKeys.all }),
            queryClient.invalidateQueries({ queryKey: itemKeys.all }),
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
        ]);
    const setMutation = useMutation({
        mutationFn: ({
            itemId,
            input,
        }: {
            itemId: string;
            input: ReadingStateUpsertInput;
        }) => setReadingState(itemId, input),
        onSuccess: invalidateBooks,
    });
    const clearMutation = useMutation({
        mutationFn: (itemId: string) => clearReadingState(itemId),
        onSuccess: invalidateBooks,
    });

    const visibleBooks = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase("ja");
        return books.filter((book) => {
            if (
                normalizedQuery &&
                !book.name.toLocaleLowerCase("ja").includes(normalizedQuery)
            ) {
                return false;
            }
            if (search.status === undefined) return true;
            return search.status === "none"
                ? book.readingStatus === null
                : book.readingStatus === search.status;
        });
    }, [books, query, search.status]);

    const openEdit = (book: BookReadingItemDto) => {
        setEditingBook(book);
        setSheetOpen(true);
    };

    // シートの中で失敗を出し分けられるよう、例外はそのまま投げ返す
    const save = async (itemId: string, change: ReadingStateChange) => {
        if (change.kind === "unchanged") return;
        if (change.kind === "clear") {
            await clearMutation.mutateAsync(itemId);
            return;
        }
        await setMutation.mutateAsync({ itemId, input: change.input });
    };

    return (
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">読書一覧</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    書籍カテゴリの品目と、その読書状態です。カテゴリの種別が書籍のときだけ読書状態を持てます。
                </p>
            </header>

            <section aria-label="書籍の検索と絞り込み">
                <FieldGroup className="gap-4 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(10rem,1fr)]">
                    <Field>
                        <FieldLabel htmlFor="book-search">
                            書籍を検索
                        </FieldLabel>
                        <div className="relative">
                            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                className="pl-8"
                                id="book-search"
                                placeholder="書籍名で検索"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                            />
                        </div>
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="book-status-filter">
                            読書状態
                        </FieldLabel>
                        <Select
                            items={statusFilterItems}
                            value={search.status ?? "all"}
                            onValueChange={(value) => {
                                const next =
                                    value && isStatusFilter(value)
                                        ? value
                                        : "all";
                                void navigate({
                                    replace: true,
                                    search: (current) => ({
                                        ...current,
                                        status:
                                            next === "all" ? undefined : next,
                                    }),
                                });
                            }}
                        >
                            <SelectTrigger
                                className="w-full"
                                id="book-status-filter"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {statusFilterItems.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                </FieldGroup>
            </section>

            <BookTable
                books={visibleBooks}
                onEdit={openEdit}
                totalCount={books.length}
            />

            <ReadingStateSheet
                book={editingBook}
                onOpenChange={(open) => {
                    setSheetOpen(open);
                    if (open) return;
                    setEditingBook(null);
                }}
                onSave={save}
                open={sheetOpen}
            />
        </main>
    );
}

function BooksPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                書籍を読み込んでいます…
            </p>
        </main>
    );
}

function BooksError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>{errorMessage(error, "書籍を読み込めませんでした")}</span>
                <Button
                    onClick={() => {
                        reset();
                        void router.invalidate();
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    再読み込み
                </Button>
            </div>
        </main>
    );
}
