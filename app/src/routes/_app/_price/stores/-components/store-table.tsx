import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom, useSetAtom } from "jotai";
import {
    Copy,
    Ellipsis,
    Pencil,
    Search,
    StoreIcon,
    Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { StoreDto } from "@/domain/store";
import { formatDisplayDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { startStoreEditAtom, storeQueryAtom } from "./store-atoms";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, StoreDto>();

// ファビコンは 1 時間キャッシュされるため、差し替え後も古い画像を見せないよう
// 更新時刻を付けて別の URL にする（query は service 側で無視される）
const faviconSrc = (store: StoreDto): string | null =>
    store.faviconUrl === null
        ? null
        : `${store.faviconUrl}?v=${encodeURIComponent(store.updatedAt)}`;

export function StoreTable({
    stores,
    onDelete,
}: {
    stores: StoreDto[];
    onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useAtom(storeQueryAtom);
    const startEdit = useSetAtom(startStoreEditAtom);
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyStoreId = useCallback(
        (store: StoreDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("店舗IDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(store.id)
                .then(() => announce(`${store.name}の店舗IDをコピーしました`))
                .catch(() => announce("店舗IDをコピーできませんでした"));
        },
        [announce],
    );
    const data = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase("ja");
        if (!normalized) return stores;
        return stores.filter((store) =>
            store.name.toLocaleLowerCase("ja").includes(normalized),
        );
    }, [query, stores]);
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.accessor((row) => row.name, {
                    id: "name",
                    header: "店名",
                    cell: ({ row }) => {
                        const src = faviconSrc(row.original);
                        return (
                            <div className="flex items-center gap-2">
                                {src === null ? (
                                    <StoreIcon
                                        aria-hidden="true"
                                        className="size-5 shrink-0 text-muted-foreground"
                                    />
                                ) : (
                                    <img
                                        alt=""
                                        className="size-5 shrink-0 rounded-sm object-contain"
                                        src={src}
                                    />
                                )}
                                <span>{row.original.name}</span>
                            </div>
                        );
                    },
                }),
                columnHelper.accessor((row) => row.url ?? "", {
                    id: "url",
                    header: "URL",
                    cell: ({ row }) => {
                        const { url } = row.original;
                        return url === null ? (
                            <span className="text-muted-foreground">—</span>
                        ) : (
                            <a
                                className="underline underline-offset-4 hover:text-primary"
                                href={url}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {url}
                            </a>
                        );
                    },
                }),
                columnHelper.accessor((row) => row.createdAt, {
                    id: "createdAt",
                    header: "登録日時",
                    cell: ({ row }) => (
                        <span className="tabular-nums">
                            {formatDisplayDateTime(row.original.createdAt) ??
                                "—"}
                        </span>
                    ),
                }),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    cell: ({ row }) => {
                        const store = row.original;
                        return (
                            <div className="flex justify-end">
                                <DropdownMenu>
                                    <DropdownMenuTrigger
                                        render={
                                            <Button
                                                aria-label={`${store.name}の操作`}
                                                size="icon-sm"
                                                type="button"
                                                variant="ghost"
                                            >
                                                <Ellipsis />
                                            </Button>
                                        }
                                    />
                                    <DropdownMenuContent
                                        align="end"
                                        // 既定では trigger 幅に揃うため項目名が折り返す
                                        className="w-auto"
                                    >
                                        {/* Base UI では GroupLabel を Group の中に置く */}
                                        <DropdownMenuGroup>
                                            <DropdownMenuLabel>
                                                操作
                                            </DropdownMenuLabel>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    copyStoreId(store)
                                                }
                                            >
                                                <Copy />
                                                店舗IDをコピー
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => startEdit(store)}
                                            >
                                                <Pencil />
                                                編集
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                // 価格記録から参照中の店舗は service 層でも削除できない
                                                onClick={() =>
                                                    void onDelete(store.id)
                                                }
                                                variant="destructive"
                                            >
                                                <Trash2 />
                                                削除
                                            </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        );
                    },
                }),
            ]),
        [copyStoreId, onDelete, startEdit],
    );
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
                <div>
                    <h2 className="font-bold">登録済み店舗</h2>
                    <p className="text-xs text-muted-foreground">
                        {stores.length} 件
                    </p>
                </div>
                <label className="relative" htmlFor="store-search">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="store-search"
                        className="pl-8"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            </div>
            <Table className="min-w-[600px]" aria-label="登録済み店舗">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    className={cn(
                                        "px-5",
                                        header.id === "actions" && "text-right",
                                    )}
                                    key={header.id}
                                    scope="col"
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : table.FlexRender({ header })}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows.length > 0 ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow key={row.id}>
                                {row.getAllCells().map((cell) => (
                                    <TableCell
                                        className="px-5 py-3"
                                        key={cell.id}
                                    >
                                        {table.FlexRender({ cell })}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell
                                className="h-24 text-center text-muted-foreground"
                                colSpan={columns.length}
                            >
                                店舗が登録されていません
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            <div aria-live="polite" className="sr-only">
                <span key={copyMessage.seq}>{copyMessage.text}</span>
            </div>
        </section>
    );
}
