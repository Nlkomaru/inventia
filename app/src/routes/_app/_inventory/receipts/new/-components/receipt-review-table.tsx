import {
    createColumnHelper,
    tableFeatures,
    useTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { ReceiptLineDto } from "@/domain/receipt";
import { formatYen } from "../../-functions/receipt-format";
import {
    actionLabels,
    type ReceiptReviewAction,
    type ReceiptReviewField,
    type ReceiptReviewNewItemForm,
    type ReceiptReviewRow,
    reviewQuantityMax,
} from "../-functions/receipt-review-form";
import {
    ReceiptReviewDetail,
    type SelectOption,
} from "./receipt-review-detail";

const actionOptions: SelectOption[] = (
    ["add_to_item", "create_item", "skip"] as const
).map((action) => ({ label: actionLabels[action], value: action }));

const expiryModeOptions: SelectOption[] = [
    { label: "この期限で入庫する", value: "date" },
    { label: "期限なし", value: "none" },
];

const isAction = (value: string | null): value is ReceiptReviewAction =>
    value === "add_to_item" || value === "create_item" || value === "skip";

/** 展開しないと直せない項目のエラー。折りたたんだままでも気付けるようにバッジで示す。 */
const detailFields = [
    "newItemName",
    "newItemCategoryId",
    "newItemLocationId",
    "newItemBaseUnit",
    "newItemBaseDimension",
] as const satisfies readonly ReceiptReviewField[];

const hasDetailIssue = (
    issues: Partial<Record<ReceiptReviewField, string>>,
): boolean => detailFields.some((field) => issues[field] !== undefined);

const emptyIssues: Partial<Record<ReceiptReviewField, string>> = {};

// 行ごとに変わる値・ハンドラはすべて行データへ持たせる。
// columns をモジュール定数に固定し、入力のたびにセルが再マウントされないようにする
// （FlexRender は cell 関数を component type として扱うため、関数の同一性が焦点を左右する）。
type ReceiptReviewTableRow = {
    line: ReceiptLineDto;
    row: ReceiptReviewRow;
    issues: Partial<Record<ReceiptReviewField, string>>;
    itemOptions: SelectOption[];
    disabled: boolean;
    expanded: boolean;
    detailInvalid: boolean;
    onChange: (patch: Partial<ReceiptReviewRow>) => void;
    onToggle: () => void;
    /** 新規品目の必須入力は詳細行にしか無いため、選んだ時点で開く。 */
    onExpand: () => void;
};

const features = tableFeatures({});
const columnHelper = createColumnHelper<
    typeof features,
    ReceiptReviewTableRow
>();

const cellId = (lineNo: number, name: string) =>
    `receipt-line-${lineNo}-cell-${name}`;
const cellErrorId = (lineNo: number, name: string) =>
    `${cellId(lineNo, name)}-error`;

const columns = columnHelper.columns([
    columnHelper.display({
        id: "line",
        header: "明細",
        cell: ({ row }) => {
            const { line, row: review, detailInvalid } = row.original;
            return (
                <div className="flex max-w-72 min-w-52 flex-col gap-1 whitespace-normal">
                    <span className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        {review.lineNo} 行目
                    </span>
                    {/* 長い商品名でも折り返して崩さない */}
                    <span className="break-words text-sm font-medium">
                        {review.rawName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        レシート表記: {line.quantity} 点 /{" "}
                        {formatYen(line.price)}
                    </span>
                    {detailInvalid ? (
                        <span className="w-fit rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                            詳細に未入力があります
                        </span>
                    ) : null}
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "action",
        header: "反映方法",
        cell: ({ row }) => {
            const { row: review, disabled, onChange, onExpand } = row.original;
            return (
                <Select
                    disabled={disabled}
                    items={actionOptions}
                    onValueChange={(value) => {
                        if (!isAction(value)) return;
                        onChange({ action: value });
                        if (value === "create_item") onExpand();
                    }}
                    value={review.action}
                >
                    <SelectTrigger
                        aria-label={`${review.lineNo} 行目の反映方法`}
                        className="w-44"
                        id={cellId(review.lineNo, "action")}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {actionOptions.map((option) => (
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
            );
        },
    }),
    columnHelper.display({
        id: "item",
        header: "反映先の品目",
        cell: ({ row }) => {
            const {
                row: review,
                issues,
                itemOptions,
                disabled,
                onChange,
            } = row.original;
            const active = review.action === "add_to_item";
            const invalid = Boolean(issues.itemId);
            return (
                <div className="flex flex-col gap-1">
                    <Select
                        disabled={
                            disabled || !active || itemOptions.length === 0
                        }
                        items={itemOptions}
                        onValueChange={(value) =>
                            onChange({ itemId: value ?? "" })
                        }
                        value={active ? review.itemId || null : null}
                    >
                        <SelectTrigger
                            aria-describedby={
                                invalid
                                    ? cellErrorId(review.lineNo, "item")
                                    : undefined
                            }
                            aria-invalid={invalid}
                            aria-label={`${review.lineNo} 行目の反映先の品目`}
                            className="w-56"
                            id={cellId(review.lineNo, "item")}
                        >
                            <SelectValue
                                placeholder={active ? "品目を選択" : "—"}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {itemOptions.map((option) => (
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
                    {invalid ? (
                        <FieldError id={cellErrorId(review.lineNo, "item")}>
                            {issues.itemId}
                        </FieldError>
                    ) : null}
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "quantity",
        header: "数量",
        cell: ({ row }) => {
            const { row: review, issues, disabled, onChange } = row.original;
            const invalid = Boolean(issues.quantity);
            return (
                <div className="flex flex-col gap-1">
                    <Input
                        aria-describedby={
                            invalid
                                ? cellErrorId(review.lineNo, "quantity")
                                : undefined
                        }
                        aria-invalid={invalid}
                        aria-label={`${review.lineNo} 行目の数量`}
                        className="w-24"
                        disabled={disabled || review.action === "skip"}
                        id={cellId(review.lineNo, "quantity")}
                        inputMode="numeric"
                        max={reviewQuantityMax}
                        min={1}
                        onChange={(event) =>
                            onChange({ quantity: event.target.value })
                        }
                        step={1}
                        type="number"
                        value={review.quantity}
                    />
                    {invalid ? (
                        <FieldError
                            className="max-w-40 whitespace-normal"
                            id={cellErrorId(review.lineNo, "quantity")}
                        >
                            {issues.quantity}
                        </FieldError>
                    ) : null}
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "price",
        header: "金額（円）",
        cell: ({ row }) => {
            const { row: review, issues, disabled, onChange } = row.original;
            const invalid = Boolean(issues.price);
            return (
                <div className="flex flex-col gap-1">
                    <Input
                        aria-describedby={
                            invalid
                                ? cellErrorId(review.lineNo, "price")
                                : undefined
                        }
                        aria-invalid={invalid}
                        aria-label={`${review.lineNo} 行目の金額（円）。空欄にすると金額なしとして扱います`}
                        className="w-28"
                        disabled={disabled || review.action === "skip"}
                        id={cellId(review.lineNo, "price")}
                        inputMode="numeric"
                        min={0}
                        onChange={(event) =>
                            onChange({ price: event.target.value })
                        }
                        placeholder="金額なし"
                        step={1}
                        type="number"
                        value={review.price}
                    />
                    {invalid ? (
                        <FieldError
                            className="max-w-40 whitespace-normal"
                            id={cellErrorId(review.lineNo, "price")}
                        >
                            {issues.price}
                        </FieldError>
                    ) : null}
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "expiry",
        header: "期限",
        cell: ({ row }) => {
            const { row: review, issues, disabled, onChange } = row.original;
            const invalid = Boolean(issues.expiryDate);
            return (
                <div className="flex flex-col gap-1">
                    <Select
                        disabled={disabled || review.action === "skip"}
                        items={expiryModeOptions}
                        onValueChange={(value) =>
                            onChange({
                                expiryMode: value === "none" ? "none" : "date",
                            })
                        }
                        value={review.expiryMode}
                    >
                        <SelectTrigger
                            aria-label={`${review.lineNo} 行目の期限の扱い`}
                            className="w-44"
                            id={cellId(review.lineNo, "expiry-mode")}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {expiryModeOptions.map((option) => (
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
                    {review.expiryMode === "date" ? (
                        <Input
                            aria-describedby={
                                invalid
                                    ? cellErrorId(review.lineNo, "expiry-date")
                                    : undefined
                            }
                            aria-invalid={invalid}
                            aria-label={`${review.lineNo} 行目の期限（年月日）`}
                            className="w-44"
                            disabled={disabled || review.action === "skip"}
                            id={cellId(review.lineNo, "expiry-date")}
                            onChange={(event) =>
                                onChange({ expiryDate: event.target.value })
                            }
                            type="date"
                            value={review.expiryDate}
                        />
                    ) : null}
                    {invalid ? (
                        <FieldError
                            className="max-w-44 whitespace-normal"
                            id={cellErrorId(review.lineNo, "expiry-date")}
                        >
                            {issues.expiryDate}
                        </FieldError>
                    ) : null}
                </div>
            );
        },
    }),
    columnHelper.display({
        id: "detail",
        header: "詳細",
        cell: ({ row }) => {
            const {
                row: review,
                expanded,
                detailInvalid,
                onToggle,
            } = row.original;
            return (
                <Button
                    aria-expanded={expanded}
                    aria-label={`${review.lineNo} 行目の詳細（照合候補・期限の根拠・新規品目）${
                        detailInvalid ? "。未入力があります" : ""
                    }`}
                    onClick={onToggle}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                >
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
            );
        },
    }),
]);

type ReceiptReviewTableProps = {
    lines: readonly ReceiptLineDto[];
    rows: readonly ReceiptReviewRow[];
    itemOptions: SelectOption[];
    categoryOptions: SelectOption[];
    locationOptions: SelectOption[];
    issueIndex: ReadonlyMap<
        string,
        Partial<Record<ReceiptReviewField, string>>
    >;
    disabled: boolean;
    onChange: (lineId: string, patch: Partial<ReceiptReviewRow>) => void;
    onNewItemChange: (
        lineId: string,
        patch: Partial<ReceiptReviewNewItemForm>,
    ) => void;
};

export function ReceiptReviewTable({
    lines,
    rows,
    itemOptions,
    categoryOptions,
    locationOptions,
    issueIndex,
    disabled,
    onChange,
    onNewItemChange,
}: ReceiptReviewTableProps) {
    const [expandedLineIds, setExpandedLineIds] = useState<ReadonlySet<string>>(
        () => new Set<string>(),
    );
    const data = useMemo<ReceiptReviewTableRow[]>(() => {
        const rowByLineId = new Map(rows.map((row) => [row.lineId, row]));
        const result: ReceiptReviewTableRow[] = [];
        for (const line of lines) {
            const row = rowByLineId.get(line.id);
            if (row === undefined) continue;
            const issues = issueIndex.get(line.id) ?? emptyIssues;
            result.push({
                line,
                row,
                issues,
                itemOptions,
                disabled,
                expanded: expandedLineIds.has(line.id),
                detailInvalid:
                    row.action === "create_item" && hasDetailIssue(issues),
                onChange: (patch) => onChange(line.id, patch),
                onToggle: () =>
                    setExpandedLineIds((current) => {
                        const next = new Set(current);
                        if (next.has(line.id)) {
                            next.delete(line.id);
                        } else {
                            next.add(line.id);
                        }
                        return next;
                    }),
                onExpand: () =>
                    setExpandedLineIds((current) =>
                        current.has(line.id)
                            ? current
                            : new Set(current).add(line.id),
                    ),
            });
        }
        return result;
    }, [
        disabled,
        expandedLineIds,
        issueIndex,
        itemOptions,
        lines,
        onChange,
        rows,
    ]);
    const table = useTable({ columns, data, features });

    return (
        <div className="overflow-x-auto">
            <Table aria-label="レシート明細の確認" className="min-w-[1080px]">
                <TableHeader className="bg-muted/50">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id} scope="col">
                                    {header.isPlaceholder
                                        ? null
                                        : table.FlexRender({ header })}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows.map((tableRow) => {
                        const { line, row, issues, expanded } =
                            tableRow.original;
                        return (
                            <Fragment key={line.id}>
                                <TableRow>
                                    {tableRow.getAllCells().map((cell) => (
                                        <TableCell
                                            className="align-top"
                                            key={cell.id}
                                        >
                                            {table.FlexRender({ cell })}
                                        </TableCell>
                                    ))}
                                </TableRow>
                                {expanded ? (
                                    <TableRow>
                                        <TableCell
                                            className="p-0 whitespace-normal"
                                            colSpan={columns.length}
                                        >
                                            <ReceiptReviewDetail
                                                categoryOptions={
                                                    categoryOptions
                                                }
                                                disabled={disabled}
                                                issues={issues}
                                                line={line}
                                                locationOptions={
                                                    locationOptions
                                                }
                                                onChange={(patch) =>
                                                    onChange(line.id, patch)
                                                }
                                                onNewItemChange={(patch) =>
                                                    onNewItemChange(
                                                        line.id,
                                                        patch,
                                                    )
                                                }
                                                row={row}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ) : null}
                            </Fragment>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
