import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import type { ItemDto } from "@/domain/item";
import type { StockOperationResult } from "@/domain/stock";
import { listItems, recordStocktake } from "./-components/stock-api";

export const Route = createFileRoute("/_app/_inventory/inventory/stocktake/")({
    staticData: {
        breadcrumbs: [{ label: "棚卸・調整" }],
    },
    component: StocktakePage,
});

function StocktakePage() {
    const [items, setItems] = useState<ItemDto[]>([]);
    const [selectedItemId, setSelectedItemId] = useState("");
    const [quantity, setQuantity] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [quantityError, setQuantityError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const pendingKey = useRef<{
        signature: string;
        value: string;
    } | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setItems(await listItems());
        } catch (cause) {
            setLoadError(
                cause instanceof Error
                    ? cause.message
                    : "品目を読み込めませんでした",
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedItemId) ?? null,
        [items, selectedItemId],
    );
    const parsedQuantity = useMemo(
        () => parseNonNegativeInteger(quantity),
        [quantity],
    );
    const difference =
        selectedItem && parsedQuantity !== null
            ? parsedQuantity - selectedItem.currentQuantity
            : null;

    const handleItemChange = (value: string | null) => {
        const nextItemId = value ?? "";
        const nextItem = items.find((item) => item.id === nextItemId);
        setSelectedItemId(nextItemId);
        setQuantity(nextItem ? String(nextItem.currentQuantity) : "");
        setSelectionError(null);
        setQuantityError(null);
        setSubmitError(null);
        setNotice(null);
        pendingKey.current = null;
    };

    const handleQuantityChange = (value: string) => {
        setQuantity(value);
        setQuantityError(null);
        setSubmitError(null);
        setNotice(null);
        pendingKey.current = null;
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSelectionError(null);
        setQuantityError(null);
        setSubmitError(null);
        setNotice(null);

        if (!selectedItem) {
            setSelectionError("品目を選択してください");
            return;
        }
        if (parsedQuantity === null) {
            setQuantityError("0以上の整数で入力してください");
            return;
        }

        const signature = `${selectedItem.id}:${parsedQuantity}`;
        const idempotencyKey =
            pendingKey.current?.signature === signature
                ? pendingKey.current.value
                : crypto.randomUUID();
        pendingKey.current = { signature, value: idempotencyKey };
        setSaving(true);
        try {
            const result = await recordStocktake(
                selectedItem.id,
                parsedQuantity,
                idempotencyKey,
            );
            applyStocktakeResult(result);
            pendingKey.current = null;
            if (result.replayed) {
                setNotice(
                    result.movement
                        ? "棚卸し結果を再表示しました（再送）。"
                        : "棚卸し結果を再表示しました。差分はなく、在庫は変わっていません（再送・no-op）。",
                );
            } else if (result.movement === null) {
                setNotice(
                    "棚卸しを記録しました。差分はなく、在庫は変わっていません（no-op）。",
                );
            } else {
                setNotice(
                    "棚卸しを記録しました。在庫履歴に差分を記録しました。",
                );
            }
        } catch (cause) {
            setSubmitError(
                cause instanceof Error
                    ? cause.message
                    : "棚卸しを記録できませんでした",
            );
        } finally {
            setSaving(false);
        }
    };

    const applyStocktakeResult = (result: StockOperationResult) => {
        setItems((current) =>
            current.map((item) =>
                item.id === result.itemId
                    ? { ...item, currentQuantity: result.currentQuantity }
                    : item,
            ),
        );
        setQuantity(String(result.currentQuantity));
    };

    const itemOptions = items.map((item) => ({
        label: item.name,
        value: item.id,
    }));

    return (
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <header>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    Inventory
                </p>
                <h1 className="mt-1 text-2xl font-bold">棚卸・調整</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    実在庫を入力し、帳簿上の在庫との差分を履歴へ記録します。
                </p>
            </header>

            {loadError ? (
                <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                    role="alert"
                >
                    <span>{loadError}</span>
                    <Button
                        onClick={() => void load()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        再読み込み
                    </Button>
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>棚卸しを記録</CardTitle>
                    <CardDescription>
                        品目を選び、現在確認できる絶対数量を入力してください。
                    </CardDescription>
                </CardHeader>
                <form onSubmit={submit}>
                    <CardContent>
                        <FieldGroup>
                            <Field data-invalid={Boolean(selectionError)}>
                                <FieldLabel htmlFor="stocktake-item">
                                    品目
                                </FieldLabel>
                                <Select
                                    disabled={loading || items.length === 0}
                                    items={itemOptions}
                                    value={selectedItemId || null}
                                    onValueChange={handleItemChange}
                                >
                                    <SelectTrigger
                                        aria-describedby={
                                            selectionError
                                                ? "stocktake-item-error"
                                                : undefined
                                        }
                                        aria-invalid={Boolean(selectionError)}
                                        className="w-full"
                                        id="stocktake-item"
                                    >
                                        <SelectValue
                                            placeholder={
                                                loading
                                                    ? "品目を読み込み中…"
                                                    : items.length === 0
                                                      ? "品目がありません"
                                                      : "品目を選択"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {itemOptions.map((item) => (
                                                <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                >
                                                    {item.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                {selectionError ? (
                                    <FieldError id="stocktake-item-error">
                                        {selectionError}
                                    </FieldError>
                                ) : null}
                            </Field>

                            {selectedItem ? (
                                <div className="grid gap-4 rounded-lg bg-muted/50 p-4 sm:grid-cols-2">
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            現在庫
                                        </p>
                                        <p
                                            aria-live="polite"
                                            className="mt-1 text-xl font-semibold"
                                        >
                                            {selectedItem.currentQuantity}{" "}
                                            {selectedItem.baseUnit}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-muted-foreground">
                                            入力との差分
                                        </p>
                                        <p
                                            aria-live="polite"
                                            className="mt-1 text-xl font-semibold"
                                        >
                                            {formatDifference(difference)}{" "}
                                            {selectedItem.baseUnit}
                                        </p>
                                    </div>
                                </div>
                            ) : null}

                            <Field data-invalid={Boolean(quantityError)}>
                                <FieldLabel htmlFor="stocktake-quantity">
                                    実在庫（絶対数量）
                                </FieldLabel>
                                <Input
                                    aria-describedby={
                                        quantityError
                                            ? "stocktake-quantity-description stocktake-quantity-error"
                                            : "stocktake-quantity-description"
                                    }
                                    aria-invalid={Boolean(quantityError)}
                                    disabled={!selectedItem || saving}
                                    id="stocktake-quantity"
                                    inputMode="numeric"
                                    min={0}
                                    onChange={(event) =>
                                        handleQuantityChange(event.target.value)
                                    }
                                    step={1}
                                    type="number"
                                    value={quantity}
                                />
                                <FieldDescription id="stocktake-quantity-description">
                                    0以上の整数を、品目の基準単位（
                                    {selectedItem?.baseUnit ?? "—"}
                                    ）で入力します。
                                </FieldDescription>
                                {quantityError ? (
                                    <FieldError id="stocktake-quantity-error">
                                        {quantityError}
                                    </FieldError>
                                ) : null}
                            </Field>
                        </FieldGroup>
                    </CardContent>
                    <CardFooter className="justify-end">
                        <Button
                            disabled={saving || loading || !selectedItem}
                            type="submit"
                        >
                            {saving
                                ? "送信中…"
                                : submitError
                                  ? "棚卸しを再送"
                                  : "棚卸しを記録"}
                        </Button>
                    </CardFooter>
                </form>
            </Card>

            {submitError ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {submitError} 内容を変えずに、もう一度送信できます。
                </div>
            ) : null}
            {notice ? (
                <output
                    aria-live="polite"
                    className="rounded-lg border border-border bg-muted/50 p-3 text-sm"
                >
                    {notice}
                </output>
            ) : null}
        </main>
    );
}

const parseNonNegativeInteger = (value: string): number | null => {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const formatDifference = (difference: number | null): string => {
    if (difference === null) return "—";
    return difference > 0 ? `+${difference}` : String(difference);
};
