import {
    createColumnHelper,
    createSortedRowModel,
    rowSortingFeature,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, MapPin, PackageOpen } from "lucide-react";

export type InventoryStatus = "在庫あり" | "残りわずか" | "在庫切れ";

export type InventoryRecord = {
    id: string;
    name: string;
    category: string;
    location: string;
    quantity: number;
    unit: string;
    status: InventoryStatus;
    expiryDate: string | null;
};

const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, InventoryRecord>();

const columns = columnHelper.columns([
    columnHelper.accessor("name", {
        header: "品目",
        cell: ({ getValue, row }) => (
            <div className="min-w-56">
                <p className="font-semibold text-slate-950">{getValue()}</p>
                <p className="mt-1 text-xs text-slate-500">
                    {row.original.category}
                </p>
            </div>
        ),
    }),
    columnHelper.accessor("location", {
        header: "保管場所",
        cell: ({ getValue }) => (
            <div className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600">
                <MapPin aria-hidden="true" className="size-4 text-slate-400" />
                {getValue()}
            </div>
        ),
    }),
    columnHelper.accessor("quantity", {
        header: "現在庫",
        cell: ({ getValue, row }) => (
            <p className="whitespace-nowrap text-right font-mono text-sm font-semibold text-slate-950">
                {getValue().toLocaleString("ja-JP")} {row.original.unit}
            </p>
        ),
        sortUndefined: "last",
    }),
    columnHelper.accessor("status", {
        header: "状態",
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    }),
    columnHelper.accessor("expiryDate", {
        header: "期限",
        cell: ({ getValue }) => (
            <span className="whitespace-nowrap text-sm text-slate-600">
                {getValue() ?? "—"}
            </span>
        ),
    }),
]);

function StatusBadge({ status }: { status: InventoryStatus }) {
    const styles: Record<InventoryStatus, string> = {
        在庫あり: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        残りわずか: "bg-amber-50 text-amber-700 ring-amber-600/20",
        在庫切れ: "bg-rose-50 text-rose-700 ring-rose-600/20",
    };

    return (
        <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}
        >
            {status}
        </span>
    );
}

export function InventoryTable({ data }: { data: InventoryRecord[] }) {
    const table = useTable({
        columns,
        data,
        enableSortingRemoval: false,
        features,
    });

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                    <h2 className="text-sm font-bold text-slate-950">
                        在庫一覧
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        {data.length} 件の品目
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <PackageOpen aria-hidden="true" className="size-4" />
                    列名をクリックして並べ替え
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead className="bg-slate-50/80">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    const sortDirection =
                                        header.column.getIsSorted();
                                    const ariaSort =
                                        sortDirection === "asc"
                                            ? "ascending"
                                            : sortDirection === "desc"
                                              ? "descending"
                                              : "none";

                                    return (
                                        <th
                                            aria-sort={ariaSort}
                                            className="whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
                                            key={header.id}
                                            scope="col"
                                        >
                                            {header.isPlaceholder ? null : (
                                                <button
                                                    aria-label={`${header.column.columnDef.header}で並べ替え`}
                                                    className="inline-flex items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    type="button"
                                                >
                                                    {table.FlexRender({
                                                        header,
                                                    })}
                                                    {sortDirection ? (
                                                        <ChevronDown
                                                            aria-hidden="true"
                                                            className={`size-3.5 transition-transform ${sortDirection === "asc" ? "rotate-180" : ""}`}
                                                        />
                                                    ) : (
                                                        <ArrowUpDown
                                                            aria-hidden="true"
                                                            className="size-3.5 opacity-50"
                                                        />
                                                    )}
                                                </button>
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        ))}
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {table.getRowModel().rows.length === 0 ? (
                            <tr>
                                <td
                                    className="px-5 py-16 text-center text-sm text-slate-500"
                                    colSpan={columns.length}
                                >
                                    該当する品目がありません
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map((row) => (
                                <tr
                                    className="transition-colors hover:bg-indigo-50/35"
                                    key={row.id}
                                >
                                    {row.getAllCells().map((cell) => (
                                        <td
                                            className="px-5 py-4 align-middle"
                                            key={cell.id}
                                        >
                                            {table.FlexRender({ cell })}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
