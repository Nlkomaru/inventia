import { ArrowUpDown, ChevronDown } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type TableSortDirection = "asc" | "desc" | false;

export function nextTableSortDirection(
    direction: TableSortDirection,
): TableSortDirection {
    if (direction === false) return "desc";
    if (direction === "desc") return "asc";
    return false;
}

export function SortableTableHead({
    children,
    className,
    direction,
    label,
    numeric = false,
    onClick,
}: {
    children: ReactNode;
    className?: string;
    direction: TableSortDirection;
    label: string;
    numeric?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
    return (
        <TableHead
            aria-sort={
                direction === "asc"
                    ? "ascending"
                    : direction === "desc"
                      ? "descending"
                      : "none"
            }
            className={cn("px-5", numeric && "text-right", className)}
            scope="col"
        >
            <Button
                aria-label={`${label}で並べ替え`}
                className={cn(
                    "-mx-2.5 min-w-max font-medium",
                    numeric && "ml-auto",
                )}
                onClick={onClick}
                size="sm"
                type="button"
                variant="ghost"
            >
                {children}
                <span
                    aria-hidden="true"
                    className="inline-flex size-4 shrink-0 items-center justify-center"
                    data-icon="inline-end"
                >
                    {direction ? (
                        <ChevronDown
                            className={cn(
                                "size-4 transition-transform",
                                direction === "asc" && "rotate-180",
                            )}
                        />
                    ) : (
                        <ArrowUpDown className="size-4 opacity-50" />
                    )}
                </span>
            </Button>
        </TableHead>
    );
}
