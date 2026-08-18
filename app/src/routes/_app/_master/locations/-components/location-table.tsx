import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom, useSetAtom } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    Copy,
    Ellipsis,
    Pencil,
    Plus,
    Search,
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
import type { LocationDto } from "@/domain/location";
import { cn } from "@/lib/utils";
import {
    expandedLocationIdsAtom,
    locationQueryAtom,
    startLocationChildAtom,
    startLocationEditAtom,
} from "./location-atoms";

type LocationTableRow = {
    item: LocationDto;
    depth: number;
    hasChildren: boolean;
    /** 子孫の場所に置かれた分も含む品目件数。 */
    itemCount: number;
};

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, LocationTableRow>();

export function LocationTable({
    locations,
    itemCounts,
    onDelete,
}: {
    locations: LocationDto[];
    /** 場所 id ごとの品目件数。子孫の分は含まない。 */
    itemCounts: Record<string, number>;
    onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useAtom(locationQueryAtom);
    const [expanded, setExpanded] = useAtom(expandedLocationIdsAtom);
    const startEdit = useSetAtom(startLocationEditAtom);
    const startChild = useSetAtom(startLocationChildAtom);
    // トーストを持たないので、コピー結果は読み上げ専用の領域だけで伝える。
    // 同じ文言でも読み上げ直すよう、連番を key にして要素ごと差し替える
    const [copyMessage, setCopyMessage] = useState({ seq: 0, text: "" });
    const announce = useCallback(
        (text: string) =>
            setCopyMessage((current) => ({ seq: current.seq + 1, text })),
        [],
    );
    const copyLocationId = useCallback(
        (location: LocationDto) => {
            // 安全なコンテキスト以外では navigator.clipboard 自体が存在しない
            if (!navigator.clipboard) {
                announce("場所IDをコピーできませんでした");
                return;
            }
            void navigator.clipboard
                .writeText(location.id)
                .then(() =>
                    announce(`${location.name}の場所IDをコピーしました`),
                )
                .catch(() => announce("場所IDをコピーできませんでした"));
        },
        [announce],
    );
    // 子孫を含む件数。親を閉じていても配下の在庫量が分かるように合算する
    const totalItemCounts = useMemo(() => {
        const childrenByParent = new Map<string | null, LocationDto[]>();
        for (const location of locations) {
            const siblings = childrenByParent.get(location.parentId) ?? [];
            siblings.push(location);
            childrenByParent.set(location.parentId, siblings);
        }
        const totals = new Map<string, number>();
        const resolve = (location: LocationDto): number => {
            const cached = totals.get(location.id);
            if (cached !== undefined) return cached;
            // 親子関係の循環は service 層で禁止しているが、壊れたデータでも
            // 無限再帰にならないよう暫定値を先に置く
            totals.set(location.id, 0);
            const total = (childrenByParent.get(location.id) ?? []).reduce(
                (sum, child) => sum + resolve(child),
                itemCounts[location.id] ?? 0,
            );
            totals.set(location.id, total);
            return total;
        };
        for (const location of locations) resolve(location);
        return totals;
    }, [itemCounts, locations]);
    const data = useMemo(() => {
        const toRow = (item: LocationDto, depth: number): LocationTableRow => ({
            item,
            depth,
            hasChildren: locations.some(
                (candidate) => candidate.parentId === item.id,
            ),
            itemCount: totalItemCounts.get(item.id) ?? 0,
        });
        const normalized = query.trim().toLocaleLowerCase("ja");
        if (normalized) {
            return locations
                .filter((item) =>
                    item.name.toLocaleLowerCase("ja").includes(normalized),
                )
                .map((item) => toRow(item, 0));
        }

        const result: LocationTableRow[] = [];
        const visit = (parentId: string | null, depth: number) => {
            for (const item of locations.filter(
                (candidate) => candidate.parentId === parentId,
            )) {
                const row = toRow(item, depth);
                result.push(row);
                if (expanded.has(item.id)) visit(item.id, depth + 1);
            }
        };
        visit(null, 0);
        return result;
    }, [expanded, locations, query, totalItemCounts]);
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.display({
                    id: "name",
                    header: "場所名",
                    cell: ({ row }) => {
                        const { depth, hasChildren, item } = row.original;
                        const isExpanded = expanded.has(item.id);
                        // 検索中の一覧は平坦なので、展開しても子行は増えない
                        const canExpand = hasChildren && !query.trim();
                        return (
                            <div
                                className="flex items-center"
                                style={{ paddingLeft: depth * 24 }}
                            >
                                {canExpand ? (
                                    <Button
                                        aria-expanded={isExpanded}
                                        aria-label={`${item.name}を展開`}
                                        onClick={() =>
                                            setExpanded((current) => {
                                                const next = new Set(current);
                                                next.has(item.id)
                                                    ? next.delete(item.id)
                                                    : next.add(item.id);
                                                return next;
                                            })
                                        }
                                        size="icon-sm"
                                        type="button"
                                        variant="ghost"
                                    >
                                        {isExpanded ? (
                                            <ChevronDown />
                                        ) : (
                                            <ChevronRight />
                                        )}
                                    </Button>
                                ) : (
                                    // 子を持たない行も名前の開始位置を揃える
                                    <span aria-hidden className="size-7" />
                                )}
                                <span>{item.name}</span>
                            </div>
                        );
                    },
                }),
                columnHelper.accessor((row) => row.itemCount, {
                    id: "itemCount",
                    header: "アイテム数",
                    cell: ({ row }) => (
                        <span className="tabular-nums">
                            {row.original.itemCount}
                        </span>
                    ),
                }),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    cell: ({ row }) => {
                        const { hasChildren, item } = row.original;
                        return (
                            <div className="flex justify-end">
                                <DropdownMenu>
                                    <DropdownMenuTrigger
                                        render={
                                            <Button
                                                aria-label={`${item.name}の操作`}
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
                                                    copyLocationId(item)
                                                }
                                            >
                                                <Copy />
                                                場所IDをコピー
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => startEdit(item)}
                                            >
                                                <Pencil />
                                                編集
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => startChild(item)}
                                            >
                                                <Plus />
                                                子の場所を追加
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                // 子を持つ場所は service 層でも削除できない
                                                disabled={hasChildren}
                                                onClick={() =>
                                                    void onDelete(item.id)
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
        [
            copyLocationId,
            expanded,
            onDelete,
            query,
            setExpanded,
            startChild,
            startEdit,
        ],
    );
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
                <div>
                    <h2 className="font-bold">登録済み保管場所</h2>
                    <p className="text-xs text-muted-foreground">
                        {locations.length} 件
                    </p>
                </div>
                <label className="relative" htmlFor="location-search">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="location-search"
                        className="pl-8"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </label>
            </div>
            <Table className="min-w-[600px]" aria-label="登録済み保管場所">
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
                                保管場所が登録されていません
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
