import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { useAtom } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    Pencil,
    Search,
    Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
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
    editingLocationAtom,
    expandedLocationIdsAtom,
    locationQueryAtom,
} from "./location-atoms";

type LocationTableRow = {
    item: LocationDto;
    depth: number;
    hasChildren: boolean;
};

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, LocationTableRow>();

export function LocationTable({
    locations,
    onDelete,
}: {
    locations: LocationDto[];
    onDelete: (id: string) => Promise<void>;
}) {
    const [query, setQuery] = useAtom(locationQueryAtom);
    const [expanded, setExpanded] = useAtom(expandedLocationIdsAtom);
    const [, setEditing] = useAtom(editingLocationAtom);
    const data = useMemo(() => {
        const toRow = (item: LocationDto, depth: number): LocationTableRow => ({
            item,
            depth,
            hasChildren: locations.some(
                (candidate) => candidate.parentId === item.id,
            ),
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
    }, [expanded, locations, query]);
    const columns = useMemo(
        () =>
            columnHelper.columns([
                columnHelper.display({
                    id: "name",
                    header: "場所名",
                    cell: ({ row }) => {
                        const { depth, hasChildren, item } = row.original;
                        const isExpanded = expanded.has(item.id);
                        return (
                            <div
                                className="flex items-center"
                                style={{ paddingLeft: depth * 24 }}
                            >
                                <Button
                                    aria-expanded={
                                        hasChildren ? isExpanded : undefined
                                    }
                                    aria-label={`${item.name}を展開`}
                                    disabled={!hasChildren}
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
                                <span>{item.name}</span>
                            </div>
                        );
                    },
                }),
                columnHelper.accessor((row) => row.item.sortOrder, {
                    id: "sortOrder",
                    header: "並び順",
                }),
                columnHelper.display({
                    id: "actions",
                    header: "操作",
                    cell: ({ row }) => {
                        const { hasChildren, item } = row.original;
                        return (
                            <div className="flex justify-end">
                                <Button
                                    aria-label={`${item.name}を編集`}
                                    onClick={() => setEditing(item)}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    <Pencil />
                                </Button>
                                <Button
                                    aria-label={`${item.name}を削除`}
                                    disabled={hasChildren}
                                    onClick={() => void onDelete(item.id)}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                >
                                    <Trash2 />
                                </Button>
                            </div>
                        );
                    },
                }),
            ]),
        [expanded, onDelete, setEditing, setExpanded],
    );
    const table = useTable({ columns, data, features });

    return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-5">
                <div>
                    <h2 className="font-bold">登録済み保管場所</h2>
                    <p className="text-xs text-muted-foreground">
                        {locations.length} 件 · D1に保存された場所
                    </p>
                </div>
                <label className="relative" htmlFor="location-search">
                    <Search className="absolute top-2.5 left-3 size-4" />
                    <span className="sr-only">検索</span>
                    <Input
                        id="location-search"
                        className="pl-9"
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
        </section>
    );
}
