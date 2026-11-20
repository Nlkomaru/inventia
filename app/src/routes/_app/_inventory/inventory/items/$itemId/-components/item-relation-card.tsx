import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { ItemDetailDto } from "@/domain/item";
import {
    linkChildItemRelation,
    unlinkChildItemRelation,
} from "../-api/item-detail-api";
import {
    inventoryKeys,
    itemKeys,
    relationCandidatesQueryOptions,
} from "../-api/item-detail-queries";

const formatQuantity = (quantity: number, unit: string): string =>
    `${quantity.toLocaleString("ja-JP")} ${unit}`;

const noCandidateValue = "__none__";

export function ItemRelationCard({ item }: { item: ItemDetailDto }) {
    const queryClient = useQueryClient();
    const [selectedChildId, setSelectedChildId] =
        useState<string>(noCandidateValue);
    const [label, setLabel] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const isChildItem = item.parentItem !== null;
    const candidatesQuery = useQuery({
        ...relationCandidatesQueryOptions(item.id),
        enabled: !isChildItem,
    });

    const candidateSelectItems = useMemo(() => {
        const items = [
            { value: noCandidateValue, label: "品目を選んでください" },
        ];
        for (const candidate of candidatesQuery.data ?? []) {
            items.push({
                value: candidate.id,
                label: `${candidate.name}（現在庫 ${formatQuantity(
                    candidate.currentQuantity,
                    candidate.baseUnit,
                )}）`,
            });
        }
        return items;
    }, [candidatesQuery.data]);

    const invalidateRelatedQueries = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: itemKeys.all }),
            queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
        ]);
    };

    const linkMutation = useMutation({
        mutationFn: () =>
            linkChildItemRelation({
                data: {
                    parentItemId: item.id,
                    childItemId: selectedChildId,
                    label: label.trim().length > 0 ? label.trim() : null,
                },
            }),
        onSuccess: async () => {
            setSelectedChildId(noCandidateValue);
            setLabel("");
            setErrorMessage(null);
            await invalidateRelatedQueries();
        },
        onError: (error) => {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "関連付けに失敗しました。",
            );
        },
    });

    const unlinkMutation = useMutation({
        mutationFn: (input: { parentItemId: string; childItemId: string }) =>
            unlinkChildItemRelation({ data: input }),
        onSuccess: async () => {
            setErrorMessage(null);
            await invalidateRelatedQueries();
        },
        onError: (error) => {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : "関連付けの解除に失敗しました。",
            );
        },
    });

    const hasRelations = item.parentItem !== null || item.childItems.length > 0;
    const busy = linkMutation.isPending || unlinkMutation.isPending;

    return (
        <Card>
            <CardHeader>
                <CardTitle>関連品目（詰め替え・予備）</CardTitle>
                <CardDescription>
                    同じ基準単位（{item.baseUnit}
                    ）の詰め替えや予備を紐付けて、ファミリー合計在庫を確認できます。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {hasRelations ? (
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">
                            ファミリー合計在庫:{" "}
                        </span>
                        <span className="font-mono font-semibold tabular-nums">
                            {formatQuantity(
                                item.familyTotalQuantity,
                                item.baseUnit,
                            )}
                        </span>
                    </div>
                ) : null}

                {errorMessage ? (
                    <p
                        aria-live="assertive"
                        className="rounded-lg border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive"
                    >
                        {errorMessage}
                    </p>
                ) : null}

                {item.parentItem ? (
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                            親品目
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                <Link
                                    className="font-medium underline underline-offset-4"
                                    params={{ itemId: item.parentItem.id }}
                                    to="/inventory/items/$itemId"
                                >
                                    {item.parentItem.name}
                                </Link>
                                {item.parentItem.label ? (
                                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                                        {item.parentItem.label}
                                    </span>
                                ) : null}
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                    現在庫{" "}
                                    {formatQuantity(
                                        item.parentItem.currentQuantity,
                                        item.parentItem.baseUnit,
                                    )}
                                </span>
                            </div>
                            <Button
                                disabled={busy}
                                onClick={() => {
                                    if (!item.parentItem) return;
                                    unlinkMutation.mutate({
                                        parentItemId: item.parentItem.id,
                                        childItemId: item.id,
                                    });
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                            >
                                解除
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            この品目は子品目として紐付いているため、さらに子品目を追加することはできません。
                        </p>
                    </div>
                ) : (
                    <>
                        {item.childItems.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                    子品目（{item.childItems.length} 件）
                                </p>
                                <ul className="flex flex-col gap-2">
                                    {item.childItems.map((child) => (
                                        <li
                                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                                            key={child.id}
                                        >
                                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                                <Link
                                                    className="font-medium underline underline-offset-4"
                                                    params={{
                                                        itemId: child.id,
                                                    }}
                                                    to="/inventory/items/$itemId"
                                                >
                                                    {child.name}
                                                </Link>
                                                {child.label ? (
                                                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                                                        {child.label}
                                                    </span>
                                                ) : null}
                                                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                                    現在庫{" "}
                                                    {formatQuantity(
                                                        child.currentQuantity,
                                                        child.baseUnit,
                                                    )}
                                                </span>
                                            </div>
                                            <Button
                                                disabled={busy}
                                                onClick={() =>
                                                    unlinkMutation.mutate({
                                                        parentItemId: item.id,
                                                        childItemId: child.id,
                                                    })
                                                }
                                                size="sm"
                                                type="button"
                                                variant="outline"
                                            >
                                                解除
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                関連付けられた子品目はまだありません。
                            </p>
                        )}

                        <form
                            className="flex flex-col gap-3 border-t pt-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (selectedChildId === noCandidateValue) {
                                    return;
                                }
                                linkMutation.mutate();
                            }}
                        >
                            <FieldGroup className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                                <Field>
                                    <FieldLabel htmlFor="relation-child-select">
                                        子品目を追加
                                    </FieldLabel>
                                    <Select
                                        disabled={
                                            busy || candidatesQuery.isLoading
                                        }
                                        items={candidateSelectItems}
                                        onValueChange={(value) =>
                                            setSelectedChildId(String(value))
                                        }
                                        value={selectedChildId}
                                    >
                                        <SelectTrigger id="relation-child-select">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {candidateSelectItems.map(
                                                    (option) => (
                                                        <SelectItem
                                                            key={option.value}
                                                            value={option.value}
                                                        >
                                                            {option.label}
                                                        </SelectItem>
                                                    ),
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="relation-label-input">
                                        ラベル（任意）
                                    </FieldLabel>
                                    <Input
                                        disabled={busy}
                                        id="relation-label-input"
                                        maxLength={50}
                                        onChange={(event) =>
                                            setLabel(event.target.value)
                                        }
                                        placeholder="例: 詰め替え、予備"
                                        value={label}
                                    />
                                </Field>
                                <Button
                                    disabled={
                                        busy ||
                                        selectedChildId === noCandidateValue
                                    }
                                    type="submit"
                                >
                                    {linkMutation.isPending
                                        ? "関連付け中…"
                                        : "関連付ける"}
                                </Button>
                            </FieldGroup>
                        </form>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
