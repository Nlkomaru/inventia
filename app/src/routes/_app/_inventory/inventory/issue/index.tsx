import {
    useMutation,
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    useRouter,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
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
import { allocateFefo, type ItemLotDto } from "@/domain/lot";
import type { StockMovementReason } from "@/domain/stock";
import { formatDisplayDateTime } from "@/lib/datetime";
import { type IssueStockInput, issueStock } from "./-api/stock-api";
import {
    inventoryKeys,
    itemKeys,
    itemListQueryOptions,
    itemLotsQueryOptions,
    stockHistoryKeys,
} from "./-api/stock-queries";
import {
    type IssuePlan,
    parsePositiveInteger,
    planLotIssue,
    toIssuePlan,
} from "./-functions/issue-plan";

export const Route = createFileRoute("/_app/_inventory/inventory/issue/")({
    loader: ({ context }) =>
        context.queryClient.ensureQueryData(itemListQueryOptions()),
    staticData: {
        breadcrumbs: [{ label: "出庫" }],
    },
    component: IssueStockPage,
    pendingComponent: IssuePending,
    errorComponent: IssueError,
});

const pageClassName = "mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8";

// 出庫の理由は減少側のものだけを出す（購入は入庫画面、棚卸しは棚卸画面で扱う）
const reasonOptions: { label: string; value: StockMovementReason }[] = [
    { label: "消費", value: "consume" },
    { label: "廃棄", value: "discard" },
    { label: "その他", value: "other" },
];

type IssueMode = "fefo" | "lot";

const modeOptions: { label: string; value: IssueMode }[] = [
    { label: "期限が早いロットから自動で引く（FEFO）", value: "fefo" },
    { label: "ロットを指定して出庫", value: "lot" },
];

const emptyPlan: IssuePlan = { status: "ready", rows: [] };

// 未取得時の既定値は参照を固定する。毎描画で新しい配列を作ると
// ロットに依存する derive が無限に走る
const noLots: ItemLotDto[] = [];

type IssueSubmitInput = IssueStockInput & { itemId: string };

function IssueStockPage() {
    const queryClient = useQueryClient();
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const [selectedItemId, setSelectedItemId] = useState("");
    const lotsQuery = useQuery(itemLotsQueryOptions(selectedItemId));
    const lots = lotsQuery.data ?? noLots;
    const [quantity, setQuantity] = useState("");
    const [mode, setMode] = useState<IssueMode>("fefo");
    const [selectedLotId, setSelectedLotId] = useState("");
    const [reason, setReason] = useState<StockMovementReason>("consume");
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [lotError, setLotError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [recorded, setRecorded] = useState<IssuePlan["rows"]>([]);
    // 送信内容が同じ限り同じ idempotency key で再送し、二重の出庫を防ぐ
    const pendingKey = useRef<{ signature: string; value: string } | null>(
        null,
    );

    // 出庫はロット構成・品目の在庫数・在庫履歴を同時に変えるため、関係する query をまとめて無効化する。
    // onSuccess の Promise を返すと mutateAsync が再取得完了まで待つ。
    const issueMutation = useMutation({
        mutationFn: ({ itemId, ...input }: IssueSubmitInput) =>
            issueStock(itemId, input),
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: stockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({
                    queryKey: inventoryKeys.all,
                }),
            ]),
    });
    const saving = issueMutation.isPending;
    const lotsLoading = lotsQuery.isLoading;
    const lotsError = lotsQuery.error
        ? errorMessage(lotsQuery.error, "ロットを読み込めませんでした")
        : null;

    // 出庫で消えたロットは選択肢から外れるため、選択を持ち越さない
    useEffect(() => {
        setSelectedLotId((current) =>
            current && lots.some((lot) => lot.id === current) ? current : "",
        );
    }, [lots]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const parsedQuantity = useMemo(
        () => parsePositiveInteger(quantity),
        [quantity],
    );
    const plan = useMemo<IssuePlan>(() => {
        if (parsedQuantity === null) {
            return emptyPlan;
        }
        if (mode === "lot") {
            return planLotIssue(
                lots.find((lot) => lot.id === selectedLotId) ?? null,
                parsedQuantity,
            );
        }
        const allocation = allocateFefo(lots, parsedQuantity);
        return toIssuePlan(allocation.allocations, allocation.shortage);
    }, [lots, mode, parsedQuantity, selectedLotId]);

    const resetFeedback = () => {
        setSelectionError(null);
        setQuantityError(null);
        setLotError(null);
        setSubmitError(null);
        setNotice(null);
        setRecorded([]);
        pendingKey.current = null;
    };

    const handleItemChange = (value: string | null) => {
        setSelectedItemId(value ?? "");
        setSelectedLotId("");
        resetFeedback();
    };

    const handleQuantityChange = (value: string) => {
        setQuantity(value);
        resetFeedback();
    };

    const handleModeChange = (value: string | null) => {
        setMode(value === "lot" ? "lot" : "fefo");
        resetFeedback();
    };

    const handleLotChange = (value: string | null) => {
        setSelectedLotId(value ?? "");
        resetFeedback();
    };

    const handleReasonChange = (value: string | null) => {
        const next = reasonOptions.find((option) => option.value === value);
        if (next) setReason(next.value);
        resetFeedback();
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSelectionError(null);
        setQuantityError(null);
        setLotError(null);
        setSubmitError(null);
        setNotice(null);

        if (!selectedItem) {
            setSelectionError("品目を選択してください");
            return;
        }
        if (parsedQuantity === null) {
            setQuantityError("1以上の整数で入力してください");
            return;
        }
        if (mode === "lot" && !selectedLotId) {
            setLotError("出庫するロットを選択してください");
            return;
        }
        if (plan.status === "shortage") {
            setQuantityError(
                `在庫が ${plan.shortage} ${selectedItem.baseUnit} 不足しています`,
            );
            return;
        }

        const lotId = mode === "lot" ? selectedLotId : null;
        const signature = JSON.stringify({
            itemId: selectedItem.id,
            quantity: parsedQuantity,
            lotId,
            reason,
        });
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };
        try {
            const result = await issueMutation.mutateAsync({
                itemId: selectedItem.id,
                quantity: parsedQuantity,
                lotId,
                reason,
                idempotencyKey,
            });
            // プレビューは送信前の在庫に基づくため、記録された内訳はサーバーの応答で置き換える
            setRecorded(result.allocations);
            setQuantity("");
            pendingKey.current = null;
            setNotice(
                result.replayed
                    ? "この出庫は既に記録済みです。保存済みの内訳を表示しました（再送）。"
                    : "出庫を記録しました。",
            );
        } catch (cause) {
            setSubmitError(errorMessage(cause, "出庫を記録できませんでした"));
        }
    };

    const itemOptions = items.map((item) => ({
        label: item.name,
        value: item.id,
    }));
    const baseUnit = selectedItem?.baseUnit ?? "—";
    const lotOptions = lots.map((lot) => ({
        label: `${formatExpiry(lot.expiryDate)}（残り ${lot.quantity} ${baseUnit}）`,
        value: lot.id,
    }));
    const shortage = plan.status === "shortage" ? plan.shortage : 0;

    return (
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">出庫</h1>
            </header>

            <section aria-labelledby="issue-form-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 id="issue-form-title" className="font-bold">
                        出庫を記録
                    </h2>
                </div>
                <form
                    className="flex max-w-2xl flex-col gap-6"
                    onSubmit={submit}
                >
                    <FieldGroup>
                        <Field data-invalid={Boolean(selectionError)}>
                            <FieldLabel htmlFor="issue-item">品目</FieldLabel>
                            <Select
                                disabled={items.length === 0}
                                items={itemOptions}
                                onValueChange={handleItemChange}
                                value={selectedItemId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={
                                        selectionError
                                            ? "issue-item-error"
                                            : undefined
                                    }
                                    aria-invalid={Boolean(selectionError)}
                                    className="w-full"
                                    id="issue-item"
                                >
                                    <SelectValue
                                        placeholder={
                                            items.length === 0
                                                ? "品目がありません"
                                                : "品目を選択"
                                        }
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
                            {selectionError ? (
                                <FieldError id="issue-item-error">
                                    {selectionError}
                                </FieldError>
                            ) : null}
                        </Field>

                        <Field data-invalid={Boolean(quantityError)}>
                            <FieldLabel htmlFor="issue-quantity">
                                出庫数量{selectedItem ? `（${baseUnit}）` : ""}
                            </FieldLabel>
                            <Input
                                aria-describedby={
                                    [
                                        selectedItem
                                            ? "issue-quantity-description"
                                            : null,
                                        quantityError
                                            ? "issue-quantity-error"
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" ") || undefined
                                }
                                aria-invalid={Boolean(quantityError)}
                                disabled={!selectedItem || saving}
                                id="issue-quantity"
                                inputMode="numeric"
                                min={1}
                                onChange={(event) =>
                                    handleQuantityChange(event.target.value)
                                }
                                step={1}
                                type="number"
                                value={quantity}
                            />
                            {selectedItem ? (
                                <FieldDescription id="issue-quantity-description">
                                    現在庫 {selectedItem.currentQuantity}{" "}
                                    {baseUnit}
                                </FieldDescription>
                            ) : null}
                            {quantityError ? (
                                <FieldError id="issue-quantity-error">
                                    {quantityError}
                                </FieldError>
                            ) : null}
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="issue-mode">
                                引き当て方法
                            </FieldLabel>
                            <Select
                                disabled={!selectedItem || saving}
                                items={modeOptions}
                                onValueChange={handleModeChange}
                                value={mode}
                            >
                                <SelectTrigger
                                    className="w-full"
                                    id="issue-mode"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {modeOptions.map((option) => (
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
                        </Field>

                        {mode === "lot" ? (
                            <Field data-invalid={Boolean(lotError)}>
                                <FieldLabel htmlFor="issue-lot">
                                    出庫するロット
                                </FieldLabel>
                                <Select
                                    disabled={
                                        !selectedItem ||
                                        saving ||
                                        lotOptions.length === 0
                                    }
                                    items={lotOptions}
                                    onValueChange={handleLotChange}
                                    value={selectedLotId || null}
                                >
                                    <SelectTrigger
                                        aria-describedby={
                                            lotError
                                                ? "issue-lot-error"
                                                : undefined
                                        }
                                        aria-invalid={Boolean(lotError)}
                                        className="w-full"
                                        id="issue-lot"
                                    >
                                        <SelectValue
                                            placeholder={
                                                lotsLoading
                                                    ? "ロットを読み込み中…"
                                                    : lotOptions.length === 0
                                                      ? "在庫のあるロットがありません"
                                                      : "ロットを選択"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {lotOptions.map((option) => (
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
                                {lotError ? (
                                    <FieldError id="issue-lot-error">
                                        {lotError}
                                    </FieldError>
                                ) : null}
                            </Field>
                        ) : null}

                        <Field>
                            <FieldLabel htmlFor="issue-reason">理由</FieldLabel>
                            <Select
                                disabled={!selectedItem || saving}
                                items={reasonOptions}
                                onValueChange={handleReasonChange}
                                value={reason}
                            >
                                <SelectTrigger
                                    className="w-full"
                                    id="issue-reason"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {reasonOptions.map((option) => (
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
                        </Field>
                    </FieldGroup>
                    <div className="flex justify-end gap-2">
                        <Button
                            disabled={
                                saving ||
                                !selectedItem ||
                                plan.status === "shortage"
                            }
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "出庫を再送"
                                  : "出庫を記録"}
                        </Button>
                    </div>
                </form>
            </section>

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="border-b p-5">
                    <h2 className="font-bold">引き当てプレビュー</h2>
                </div>
                {lotsError ? (
                    <div className="p-5">
                        <div
                            aria-live="polite"
                            className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{lotsError}</span>
                            <Button
                                onClick={() => void lotsQuery.refetch()}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                再読み込み
                            </Button>
                        </div>
                    </div>
                ) : null}
                <output aria-live="polite" className="block">
                    {!selectedItem ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            品目を選ぶと、引き当てられるロットを表示します。
                        </p>
                    ) : lotsLoading ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            ロットを読み込み中…
                        </p>
                    ) : lots.length === 0 ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            在庫のあるロットがありません。先に入庫を記録してください。
                        </p>
                    ) : plan.rows.length === 0 ? (
                        <p className="p-5 text-sm text-muted-foreground">
                            数量を入力すると、引き当てるロットを表示します。
                        </p>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead className="px-5">期限</TableHead>
                                    <TableHead className="px-5 text-right">
                                        引き当て
                                    </TableHead>
                                    <TableHead className="px-5 text-right">
                                        出庫後の残り
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {plan.rows.map((row) => (
                                    <TableRow key={row.lotId}>
                                        <TableCell className="px-5 py-3">
                                            {formatExpiry(row.expiryDate)}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 text-right">
                                            {row.delta} {baseUnit}
                                        </TableCell>
                                        <TableCell className="px-5 py-3 text-right">
                                            {remainingQuantity(
                                                lots,
                                                row.lotId,
                                                row.delta,
                                            )}{" "}
                                            {baseUnit}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {shortage > 0 ? (
                        <p className="px-5 pb-5 text-sm font-medium text-destructive">
                            在庫が {shortage} {baseUnit}{" "}
                            不足しています。数量またはロットを見直してください。
                        </p>
                    ) : null}
                </output>
            </section>

            {submitError ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {submitError}
                </div>
            ) : null}
            {notice ? (
                <output
                    aria-live="polite"
                    className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm"
                >
                    <span>{notice}</span>
                    {recorded.length > 0 ? (
                        <ul className="flex flex-col gap-1 text-muted-foreground">
                            {recorded.map((allocation) => (
                                <li key={allocation.lotId}>
                                    {formatExpiry(allocation.expiryDate)}:{" "}
                                    {allocation.delta} {baseUnit}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </output>
            ) : null}
        </main>
    );
}

function IssuePending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                品目を読み込んでいます…
            </p>
        </main>
    );
}

function IssueError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="polite"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>{errorMessage(error, "品目を読み込めませんでした")}</span>
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
            </div>
        </main>
    );
}

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const formatExpiry = (value: string | null): string =>
    (value === null ? null : formatDisplayDateTime(value)) ?? "期限なし";

const remainingQuantity = (
    lots: readonly ItemLotDto[],
    lotId: string,
    delta: number,
): number => {
    const lot = lots.find((candidate) => candidate.id === lotId);
    return lot ? lot.quantity + delta : 0;
};
