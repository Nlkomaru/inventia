import { useSuspenseQuery } from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    useRouter,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { receiptDetailQueryOptions } from "../-api/receipt-queries";
import {
    formatDateTimeOrDash,
    formatExpiryDate,
    formatYen,
    receiptStatusClassNames,
    receiptStatusLabels,
} from "../-functions/receipt-format";

// 幅は他の画面と揃える。ここだけ狭いと一覧から入ったときに幅が変わって見える
const pageClassName =
    "mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8";

/** 画像は API から配信する。R2 のオブジェクトキーは公開しない。 */
const receiptImageSrc = (receiptId: string): string =>
    `/api/receipts/${encodeURIComponent(receiptId)}/image`;

const resumeSearch = (receiptId: string) => ({ receiptId }) as const;

export const Route = createFileRoute("/_app/_inventory/receipts/$receiptId/")({
    loader: ({ context, params }) =>
        context.queryClient.ensureQueryData(
            receiptDetailQueryOptions(params.receiptId),
        ),
    staticData: {
        // パンくずは静的なため店舗名は入れず、見出しで示す
        breadcrumbs: [
            { label: "レシート取込", to: "/receipts" },
            { label: "取込の内容" },
        ],
    },
    component: ReceiptDetailPage,
    pendingComponent: ReceiptDetailPending,
    errorComponent: ReceiptDetailError,
});

function ReceiptDetailPage() {
    const { receiptId } = Route.useParams();
    const { data: receipt } = useSuspenseQuery(
        receiptDetailQueryOptions(receiptId),
    );
    // 反映済みのレシートは記録として読むだけ。まだ反映していないものは
    // 確認画面へ戻れるようにする
    const resumable = receipt.status !== "applied";

    return (
        <main className={pageClassName}>
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold break-words">
                        {receipt.storeName ?? "店舗名なし"}
                    </h1>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${receiptStatusClassNames[receipt.status]}`}
                        >
                            {receiptStatusLabels[receipt.status]}
                        </span>
                        {formatDateTimeOrDash(receipt.purchasedAt)} に購入
                    </p>
                </div>
                {resumable ? (
                    <Button
                        nativeButton={false}
                        render={
                            <Link
                                search={resumeSearch(receipt.id)}
                                to="/receipts/new"
                            />
                        }
                        variant="outline"
                    >
                        取込を続ける
                    </Button>
                ) : null}
            </header>

            {receipt.status === "failed" && receipt.errorMessage !== null ? (
                <p
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {receipt.errorMessage}
                </p>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>取込の情報</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                取込日時
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatDateTimeOrDash(receipt.createdAt)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                反映日時
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatDateTimeOrDash(receipt.appliedAt)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                レシート記載の合計
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatYen(receipt.totalPrice)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                明細の合計
                            </dt>
                            <dd className="mt-1 text-sm">
                                {formatYen(receipt.linesTotalPrice)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                解析モデル
                            </dt>
                            <dd className="mt-1 break-words text-sm">
                                {receipt.model ?? "—"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-sm text-muted-foreground">
                                明細の件数
                            </dt>
                            <dd className="mt-1 text-sm">
                                {receipt.lineCount} 件
                            </dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>レシートの画像</CardTitle>
                    <CardDescription>
                        取り込んだときの写真です。読み取りの根拠として残しています。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {/* 縦長の写真が画面を埋め尽くさないよう高さで抑える */}
                    <img
                        alt={`${receipt.storeName ?? "レシート"}の写真`}
                        className="max-h-[70vh] w-auto max-w-full rounded-lg border object-contain"
                        src={receiptImageSrc(receipt.id)}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>明細</CardTitle>
                    <CardDescription>
                        解析した明細と、反映先として確定した品目です。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {receipt.lines.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            明細がありません。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>商品</TableHead>
                                    <TableHead className="text-right">
                                        数量
                                    </TableHead>
                                    <TableHead className="text-right">
                                        金額
                                    </TableHead>
                                    <TableHead>期限</TableHead>
                                    <TableHead>反映先の品目</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {receipt.lines.map((line) => (
                                    <TableRow key={line.id}>
                                        <TableCell className="max-w-64 align-top">
                                            <p className="break-words text-sm font-medium">
                                                {line.completedName ??
                                                    line.rawName}
                                            </p>
                                            {line.completedName ===
                                            null ? null : (
                                                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                                                    レシート表記: {line.rawName}
                                                </p>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right align-top whitespace-nowrap">
                                            {line.quantity}{" "}
                                            {line.suggestedBaseUnit ?? ""}
                                        </TableCell>
                                        <TableCell className="text-right align-top whitespace-nowrap">
                                            {formatYen(line.price)}
                                        </TableCell>
                                        <TableCell className="align-top whitespace-nowrap">
                                            {formatExpiryDate(
                                                line.suggestedExpiryDate,
                                            )}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {line.matchedItemId === null ? (
                                                <span className="text-sm text-muted-foreground">
                                                    {line.stockRelevant
                                                        ? "—"
                                                        : "在庫に置かない"}
                                                </span>
                                            ) : (
                                                <Link
                                                    className="text-sm underline-offset-4 hover:underline"
                                                    params={{
                                                        itemId: line.matchedItemId,
                                                    }}
                                                    to="/inventory/items/$itemId"
                                                >
                                                    {line.matchedItemName ??
                                                        line.matchedItemId}
                                                </Link>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}

function ReceiptDetailPending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                レシートを読み込んでいます…
            </p>
        </main>
    );
}

function ReceiptDetailError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {error instanceof Error
                        ? error.message
                        : "レシートを読み込めませんでした"}
                </span>
                <div className="flex gap-2">
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
                    <Button
                        nativeButton={false}
                        render={<Link to="/receipts" />}
                        size="sm"
                        variant="outline"
                    >
                        取込履歴へ戻る
                    </Button>
                </div>
            </div>
        </main>
    );
}
