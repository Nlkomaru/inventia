import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { priceComparisonBasis, priceComparisonUnit } from "@/domain/price";
import type {
    PriceResearchRequestDto,
    PriceResearchStatus,
} from "@/domain/priceResearch";
import type { StoreDto } from "@/domain/store";
import { formatDisplayMonthDayTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { CreateResearchDialog } from "./create-research-dialog";
import { PendingResearchRow } from "./pending-research-row";

interface PriceResearchPageProps {
    status: PriceResearchStatus;
    onStatusChange: (status: PriceResearchStatus) => void;
    requests: PriceResearchRequestDto[];
    items: ItemDto[];
    stores: StoreDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
    error: string | null;
    onRetry: () => void;
}

const statusTabs: readonly { value: PriceResearchStatus; label: string }[] = [
    { value: "pending", label: "未調査" },
    { value: "completed", label: "調査済み" },
    { value: "cancelled", label: "キャンセル" },
];

export function PriceResearchPage({
    status,
    onStatusChange,
    requests,
    items,
    stores,
    categories,
    locations,
    hasNextPage,
    isFetchingNextPage,
    onLoadMore,
    error,
    onRetry,
}: PriceResearchPageProps) {
    return (
        <main className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="mt-1 text-2xl font-bold">価格調査依頼</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        AI
                        や手動で追加された価格調査の依頼一覧です。内容量・価格・店舗を入力すると単価が計算されて価格履歴へ登録されます。
                    </p>
                </div>
                <CreateResearchDialog items={items} />
            </header>

            <div
                aria-label="ステータス絞り込み"
                className="inline-flex rounded-lg border bg-muted/40 p-1"
                role="tablist"
            >
                {statusTabs.map((tab) => {
                    const selected = status === tab.value;
                    return (
                        <button
                            aria-selected={selected}
                            className={cn(
                                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                selected
                                    ? "bg-background text-foreground shadow-xs"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                            key={tab.value}
                            onClick={() => onStatusChange(tab.value)}
                            role="tab"
                            type="button"
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {error ? (
                <div
                    aria-live="assertive"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{error}</span>
                    <Button
                        onClick={onRetry}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                </div>
            ) : null}

            {requests.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {status === "pending"
                        ? "未調査の価格調査依頼はありません。"
                        : status === "completed"
                          ? "調査済みの価格調査依頼はありません。"
                          : "キャンセルされた価格調査依頼はありません。"}
                </div>
            ) : status === "pending" ? (
                <div className="overflow-x-auto rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>品目</TableHead>
                                <TableHead>用途・メモ</TableHead>
                                <TableHead>内容量・単位・個数</TableHead>
                                <TableHead>価格・店舗</TableHead>
                                <TableHead>操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {requests.map((request) => (
                                <PendingResearchRow
                                    categories={categories}
                                    items={items}
                                    key={request.id}
                                    locations={locations}
                                    request={request}
                                    stores={stores}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ) : status === "completed" ? (
                <div className="overflow-x-auto rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>品目</TableHead>
                                <TableHead>用途・メモ</TableHead>
                                <TableHead>店舗</TableHead>
                                <TableHead>内容量</TableHead>
                                <TableHead className="text-right">
                                    価格
                                </TableHead>
                                <TableHead className="text-right">
                                    単価
                                </TableHead>
                                <TableHead>完了日時</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {requests.map((request) => {
                                const pr = request.priceRecord;
                                return (
                                    <TableRow key={request.id}>
                                        <TableCell className="font-medium">
                                            {request.itemId !== null ? (
                                                <Link
                                                    className="underline-offset-4 hover:underline"
                                                    params={{
                                                        itemId: request.itemId,
                                                    }}
                                                    to="/inventory/items/$itemId"
                                                >
                                                    {request.item?.name ??
                                                        request.requestedItemName}
                                                </Link>
                                            ) : (
                                                request.requestedItemName
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {request.purpose ? (
                                                <p className="text-foreground">
                                                    {request.purpose}
                                                </p>
                                            ) : null}
                                            {request.note ? (
                                                <p>{request.note}</p>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            {pr
                                                ? (pr.storeName ?? pr.source)
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {pr
                                                ? `${pr.contentAmount.toLocaleString("ja-JP")} × ${pr.setCount} ${pr.baseUnit}${pr.packaging ? `（${pr.packaging}）` : ""}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                                            {pr
                                                ? `¥${pr.price.toLocaleString("ja-JP")}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                                            {pr
                                                ? `${pr.unitPrice.toFixed(2)} 円 / ${priceComparisonBasis(pr.baseDimension)} ${priceComparisonUnit(pr.baseDimension, pr.baseUnit)}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                                            {request.completedAt
                                                ? (formatDisplayMonthDayTime(
                                                      request.completedAt,
                                                  ) ?? request.completedAt)
                                                : "—"}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>品目名</TableHead>
                                <TableHead>希望単位</TableHead>
                                <TableHead>用途・メモ</TableHead>
                                <TableHead>依頼元</TableHead>
                                <TableHead>更新日時</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {requests.map((request) => (
                                <TableRow key={request.id}>
                                    <TableCell className="font-medium">
                                        {request.requestedItemName}
                                    </TableCell>
                                    <TableCell>
                                        {request.requestedUnit ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {request.purpose ? (
                                            <p className="text-foreground">
                                                {request.purpose}
                                            </p>
                                        ) : null}
                                        {request.note ? (
                                            <p>{request.note}</p>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                        {request.requestedBy ?? "—"}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                                        {formatDisplayMonthDayTime(
                                            request.updatedAt,
                                        ) ?? request.updatedAt}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {hasNextPage ? (
                <div className="flex justify-center">
                    <Button
                        disabled={isFetchingNextPage}
                        onClick={onLoadMore}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        {isFetchingNextPage ? "読み込み中…" : "さらに読み込む"}
                    </Button>
                </div>
            ) : null}
        </main>
    );
}
