import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom, useSetAtom } from "jotai";
import { Copy, Ellipsis, Pencil, Search, Trash2 } from "lucide-react";
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
import type { ExternalProviderDto } from "@/domain/externalProvider";
import { formatDisplayDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { providerQueryAtom, startProviderEditAtom } from "./provider-atoms";
import { ProviderFavicon } from "./provider-favicon";

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, ExternalProviderDto>();

export function ProviderTable({
    providers,
    onDelete,
}: {
    providers: ExternalProviderDto[];
    onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useAtom(providerQueryAtom);
    const startEdit = useSetAtom(startProviderEditAtom);
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyProviderId = useCallback(
        (provider: ExternalProviderDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("連携先IDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(provider.id)
                .then(() =>
                    announce(`${provider.name}の連携先IDをコピーしました`),
                )
                .catch(() => announce("連携先IDをコピーできませんでした"));
        },
        [announce],
    );
    const data = useMemo(() => {
        const normalized = query.trim().toLocaleLowerCase("ja");
        if (!normalized) return providers;
        return providers.filter((provider) =>
            provider.name.toLocaleLowerCase("ja").includes(normalized),
        );
    }, [providers, query]);
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.accessor((row) => row.name, {
                    id: "name",
                    header: "連携先名",
                    cell: ({ row }) => (
                        <div className="flex items-center gap-2">
                            <ProviderFavicon
                                faviconUrl={row.original.faviconUrl}
                            />
                            <span>{row.original.name}</span>
                        </div>
                    ),
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
                        const provider = row.original;
                        return (
                            <div className="flex justify-end">
                                <DropdownMenu>
                                    <DropdownMenuTrigger
                                        render={
                                            <Button
                                                aria-label={`${provider.name}の操作`}
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
                                                    copyProviderId(provider)
                                                }
                                            >
                                                <Copy />
                                                連携先IDをコピー
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    startEdit(provider)
                                                }
                                            >
                                                <Pencil />
                                                編集
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                // 在庫履歴から参照中の連携先は service 層でも削除できない
                                                onClick={() =>
                                                    void onDelete(provider.id)
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
        [copyProviderId, onDelete, startEdit],
    );
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-end border-b p-5">
                <label className="relative" htmlFor="provider-search">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="provider-search"
                        className="pl-8"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            </div>
            <Table className="min-w-[600px]" aria-label="登録済み連携先">
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
                                連携先が登録されていません
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
