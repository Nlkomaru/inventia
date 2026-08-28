"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
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
import { type McpUsageSummary, mcpUsagePeriodDays } from "@/domain/usage";
import { formatDisplayDateTime } from "@/lib/datetime";
import {
    mcpUsageQueryOptions,
    openRouterUsageQueryOptions,
} from "../-api/usage-queries";

const numberFormat = new Intl.NumberFormat("ja-JP");

const formatDateTime = (value: string): string =>
    formatDisplayDateTime(value) ?? value;

const queryErrorMessage = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

function RetryButton({ onClick }: { onClick: () => void }) {
    return (
        <Button onClick={onClick} size="sm" type="button" variant="outline">
            <RefreshCwIcon aria-hidden="true" />
            再読み込み
        </Button>
    );
}

function QueryError({
    error,
    fallback,
    onRetry,
}: {
    error: unknown;
    fallback: string;
    onRetry: () => void;
}) {
    return (
        <div
            aria-live="assertive"
            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
            role="alert"
        >
            <span>{queryErrorMessage(error, fallback)}</span>
            <RetryButton onClick={onRetry} />
        </div>
    );
}

function OpenRouterUsageCard() {
    const query = useQuery(openRouterUsageQueryOptions());
    const usage = query.data;

    return (
        <Card>
            <CardHeader>
                <CardTitle>OpenRouter</CardTitle>
                <CardDescription>
                    inventia workspace の直近30完了UTC日。Management key
                    は画面へ返しません。
                </CardDescription>
            </CardHeader>
            <CardContent>
                {query.isPending ? (
                    <p className="text-sm text-muted-foreground">
                        OpenRouter の利用量を取得しています。
                    </p>
                ) : query.error ? (
                    <QueryError
                        error={query.error}
                        fallback="OpenRouter の利用量を取得できませんでした。"
                        onRetry={() => void query.refetch()}
                    />
                ) : usage ? (
                    <>
                        <dl className="grid gap-4 sm:grid-cols-3">
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    合計トークン
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    {numberFormat.format(usage.totalTokens)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    リクエスト数
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    {numberFormat.format(usage.requestCount)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    利用額
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    ${usage.cost.toFixed(6)}
                                </dd>
                            </div>
                        </dl>
                        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                            <div>
                                <dt className="text-muted-foreground">
                                    入力トークン
                                </dt>
                                <dd className="font-mono tabular-nums">
                                    {numberFormat.format(usage.promptTokens)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    出力トークン
                                </dt>
                                <dd className="font-mono tabular-nums">
                                    {numberFormat.format(
                                        usage.completionTokens,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">
                                    推論トークン
                                </dt>
                                <dd className="font-mono tabular-nums">
                                    {numberFormat.format(usage.reasoningTokens)}
                                </dd>
                            </div>
                        </dl>
                        {usage.models.length === 0 ? (
                            <p className="mt-5 text-sm text-muted-foreground">
                                利用記録がありません。
                            </p>
                        ) : (
                            <div className="mt-5 overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>モデル</TableHead>
                                            <TableHead>プロバイダー</TableHead>
                                            <TableHead className="text-right">
                                                リクエスト
                                            </TableHead>
                                            <TableHead className="text-right">
                                                トークン
                                            </TableHead>
                                            <TableHead className="text-right">
                                                利用額
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {usage.models.map((model) => (
                                            <TableRow
                                                key={`${model.model}:${model.providerName}`}
                                            >
                                                <TableCell className="font-mono text-xs">
                                                    {model.model}
                                                </TableCell>
                                                <TableCell>
                                                    {model.providerName}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums">
                                                    {numberFormat.format(
                                                        model.requestCount,
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums">
                                                    {numberFormat.format(
                                                        model.totalTokens,
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right font-mono tabular-nums">
                                                    ${model.cost.toFixed(6)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </>
                ) : null}
            </CardContent>
        </Card>
    );
}

function McpActivity({ usage }: { usage: McpUsageSummary }) {
    const maxCalls = Math.max(
        1,
        ...usage.activity.map((entry) => entry.callCount),
    );
    return (
        <div className="overflow-x-auto">
            <ol
                aria-label={`直近${mcpUsagePeriodDays} UTC日のMCP呼び出し数`}
                className="grid min-w-[720px] grid-cols-[repeat(30,minmax(1.5rem,1fr))] items-end gap-1"
            >
                {usage.activity.map((entry) => {
                    const height = `${Math.max(
                        entry.callCount === 0 ? 0 : 8,
                        (entry.callCount / maxCalls) * 100,
                    )}%`;
                    return (
                        <li
                            aria-label={`${entry.date}: ${numberFormat.format(entry.callCount)}回`}
                            className="flex h-36 flex-col justify-end gap-2"
                            key={entry.date}
                            title={`${entry.date} UTC: ${numberFormat.format(entry.callCount)}回`}
                        >
                            <div
                                aria-hidden="true"
                                className="min-h-0 rounded-t-sm bg-primary/75"
                                style={{ height }}
                            />
                            <span className="truncate text-center font-mono text-[10px] text-muted-foreground">
                                {entry.date.slice(5)}
                            </span>
                        </li>
                    );
                })}
            </ol>
            {usage.activity.every((entry) => entry.callCount === 0) ? (
                <p className="mt-3 text-sm text-muted-foreground">
                    この期間の利用記録はありません。
                </p>
            ) : null}
        </div>
    );
}

function McpUsageCard() {
    const query = useQuery(mcpUsageQueryOptions());
    const usage = query.data;

    return (
        <Card>
            <CardHeader>
                <CardTitle>MCP ツール呼び出し</CardTitle>
                <CardDescription>
                    mcp_tool_calls の記録を tool 名ごとに集計。時刻は UTC
                    で保存され、入力・出力・認証情報は表示しません。
                </CardDescription>
            </CardHeader>
            <CardContent>
                {query.isPending ? (
                    <p className="text-sm text-muted-foreground">
                        MCP の利用量を取得しています。
                    </p>
                ) : query.error ? (
                    <QueryError
                        error={query.error}
                        fallback="MCP の利用量を取得できませんでした。"
                        onRetry={() => void query.refetch()}
                    />
                ) : usage ? (
                    <>
                        <dl className="grid gap-4 sm:grid-cols-3">
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    総呼び出し数
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    {numberFormat.format(usage.totalCalls)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    利用ツール数
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    {numberFormat.format(usage.tools.length)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-sm text-muted-foreground">
                                    集計期間
                                </dt>
                                <dd className="mt-1 font-mono text-xl font-semibold tabular-nums">
                                    直近{usage.periodDays} UTC日
                                </dd>
                            </div>
                        </dl>

                        <section
                            aria-labelledby="mcp-activity-title"
                            className="mt-8"
                        >
                            <h3
                                id="mcp-activity-title"
                                className="font-semibold"
                            >
                                日別アクティビティ
                            </h3>
                            <p className="mb-4 mt-1 text-sm text-muted-foreground">
                                総呼び出し数は全期間、アクティビティは直近
                                {usage.periodDays} UTC日です。
                            </p>
                            <McpActivity usage={usage} />
                        </section>

                        <section
                            aria-labelledby="mcp-tools-title"
                            className="mt-8"
                        >
                            <h3 id="mcp-tools-title" className="font-semibold">
                                ツール別
                            </h3>
                            {usage.tools.length === 0 ? (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    利用記録がありません。
                                </p>
                            ) : (
                                <div className="mt-3 overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>ツール</TableHead>
                                                <TableHead className="text-right">
                                                    呼び出し数
                                                </TableHead>
                                                <TableHead>
                                                    最終呼び出し
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usage.tools.map((tool) => (
                                                <TableRow key={tool.toolId}>
                                                    <TableCell className="font-mono text-xs">
                                                        {tool.name}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono tabular-nums">
                                                        {numberFormat.format(
                                                            tool.callCount,
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        {formatDateTime(
                                                            tool.lastCalledAt,
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </section>

                        <section
                            aria-labelledby="mcp-recent-title"
                            className="mt-8"
                        >
                            <h3 id="mcp-recent-title" className="font-semibold">
                                最近の呼び出し
                            </h3>
                            {usage.recentCalls.length === 0 ? (
                                <p className="mt-3 text-sm text-muted-foreground">
                                    利用記録がありません。
                                </p>
                            ) : (
                                <div className="mt-3 overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>時刻</TableHead>
                                                <TableHead>ツール</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usage.recentCalls.map((call) => (
                                                <TableRow key={call.id}>
                                                    <TableCell className="whitespace-nowrap">
                                                        {formatDateTime(
                                                            call.calledAt,
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        {call.toolName}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </section>
                    </>
                ) : null}
            </CardContent>
        </Card>
    );
}

export function UsagePage() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">利用状況</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    AI モデルと MCP ツールの利用記録を確認できます。
                </p>
            </header>
            <OpenRouterUsageCard />
            <McpUsageCard />
        </main>
    );
}
