import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Field,
    FieldContent,
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
import { Textarea } from "@/components/ui/textarea";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemBaseDimension,
    type ItemDetailDto,
    type ItemUpdateInput,
    itemUpdateSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { getPriceUnitDefinition } from "@/domain/price";
import {
    buildHierarchyLabels,
    getEffectiveCategoryKind,
} from "@/lib/hierarchy";
import type { ItemRelabelImpact } from "../-api/item-api";
import { updateItem } from "../-api/item-api";
import { inventoryKeys, itemKeys } from "../-api/item-queries";

type FormValues = {
    name: string;
    categoryId: string;
    locationId: string;
    baseUnit: string;
    baseDimension: ItemBaseDimension;
    lowStockThreshold: string;
    memo: string;
};

type FieldErrors = Partial<Record<keyof FormValues | "relabelAck", string>>;

type ItemMasterFormProps = {
    item: ItemDetailDto;
    categories: CategoryDto[];
    locations: LocationDto[];
    impact: ItemRelabelImpact;
};

// 編集ダイアログと同じ表記。マスタの表示はルートごとに閉じる
const dimensionLabels: Record<ItemBaseDimension, string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

const initialForm = (item: ItemDetailDto): FormValues => ({
    name: item.name,
    categoryId: item.categoryId,
    locationId: item.locationId,
    baseUnit: item.baseUnit,
    baseDimension: item.baseDimension,
    lowStockThreshold:
        item.lowStockThreshold === null ? "" : String(item.lowStockThreshold),
    memo: item.memo ?? "",
});

const parseNullableInteger = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
};

const fieldErrorsFromIssues = (
    issues: readonly { message: string; path: PropertyKey[] }[],
    keys: readonly (keyof FormValues)[],
): FieldErrors => {
    const errors: FieldErrors = {};
    for (const issue of issues) {
        const field = issue.path[0];
        const known = keys.find((key) => key === field);
        if (known) errors[known] ??= issue.message;
    }
    return errors;
};

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

/**
 * 品目マスタの編集。基準単位と次元は換算を伴わない「つけ替え」で、保存済みの
 * 数量の数値は書き換わらない。意味だけが変わるため、対象の記録がある品目では
 * 了解のチェックを入れるまで保存させない。
 */
export function ItemMasterForm({
    item,
    categories,
    locations,
    impact,
}: ItemMasterFormProps) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const [form, setForm] = useState<FormValues>(() => initialForm(item));
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    // 了解のチェック。単位・次元を編集し直すたびに外し、その時点の変更に対して
    // 改めて了解を取る
    const [relabelAck, setRelabelAck] = useState(false);

    const categoryLabels = useMemo(
        () => buildHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => buildHierarchyLabels(locations),
        [locations],
    );
    // 品目の実効カテゴリー種別は変えられない（種別が変わると基準単位の要否も変わる）。
    // 編集ダイアログと同じ規則で、同じ種別のカテゴリだけを選ばせる
    const itemCategoryKind = useMemo(
        () => getEffectiveCategoryKind(item.categoryId, categories),
        [categories, item.categoryId],
    );
    const availableCategories = useMemo(
        () =>
            categories.filter(
                (category) =>
                    getEffectiveCategoryKind(category.id, categories) ===
                    itemCategoryKind,
            ),
        [categories, itemCategoryKind],
    );
    const categoryItems = useMemo(
        () => [
            { label: "カテゴリを選択", value: null },
            ...availableCategories.map((category) => ({
                label: categoryLabels.get(category.id) ?? category.name,
                value: category.id,
            })),
        ],
        [availableCategories, categoryLabels],
    );
    const locationItems = useMemo(
        () => [
            { label: "保管場所を選択", value: null },
            ...locations.map((location) => ({
                label: locationLabels.get(location.id) ?? location.name,
                value: location.id,
            })),
        ],
        [locationLabels, locations],
    );
    const dimensionItems = useMemo(
        () =>
            Object.entries(dimensionLabels).map(([value, label]) => ({
                value,
                label,
            })),
        [],
    );

    // つけ替えかどうかは保存済みの値との差で決める。入力を戻せば関門も消える
    const relabeling =
        form.baseUnit.trim() !== item.baseUnit ||
        form.baseDimension !== item.baseDimension;
    // 数値の意味が変わる記録。在庫 0 でも履歴や価格が残っていれば警告する。
    // 発注点も基準単位で表した在庫下限なので、つけ替えで意味だけが変わる
    const hasAffectedRecords =
        item.currentQuantity > 0 ||
        item.lots.length > 0 ||
        impact.hasStockMovements ||
        impact.hasPriceRecords ||
        item.lowStockThreshold !== null;
    const gated = relabeling && hasAffectedRecords;
    // 単価は保存せず基準単位から導くため、価格記録がある品目を質量・体積の
    // 単位表に無い単位へ移すと既存の価格記録を読めなくなる。API も 409 で
    // 拒むが、送る前に日本語で理由と次の行動を出す
    const priceUnitBlocked =
        relabeling &&
        impact.hasPriceRecords &&
        form.baseDimension !== "count" &&
        getPriceUnitDefinition(form.baseUnit.trim())?.dimension !==
            form.baseDimension;

    const updateMutation = useMutation({
        mutationFn: (input: ItemUpdateInput) => updateItem(item.id, input),
        // 基準単位は在庫一覧の数量表示にも出るため ["inventory"] も無効化する
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
            ]),
    });

    const update = <K extends keyof FormValues>(
        key: K,
        value: FormValues[K],
    ) => {
        setForm((current) => ({ ...current, [key]: value }));
        setSaved(false);
        // 了解は「今のつけ替え」に対するもの。単位・次元を触り直したら取り消す
        if (key === "baseUnit" || key === "baseDimension") {
            setRelabelAck(false);
        }
        setFieldErrors((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);
        setFieldErrors({});
        setSaved(false);
        const name = form.name.trim();
        if (!name) {
            setFieldErrors({ name: "品目名を入力してください" });
            setError("品目名を入力してください");
            return;
        }
        if (!form.categoryId || !form.locationId) {
            const errors: FieldErrors = {};
            if (!form.categoryId)
                errors.categoryId = "カテゴリを選択してください";
            if (!form.locationId)
                errors.locationId = "保管場所を選択してください";
            setFieldErrors(errors);
            setError("カテゴリと保管場所を選択してください");
            return;
        }
        if (!form.baseUnit.trim()) {
            setFieldErrors({ baseUnit: "基準単位を入力してください" });
            setError("基準単位を入力してください");
            return;
        }
        const lowStockThreshold = parseNullableInteger(form.lowStockThreshold);
        if (form.lowStockThreshold.trim() && lowStockThreshold === null) {
            setFieldErrors({
                lowStockThreshold: "発注点は0以上の整数で入力してください",
            });
            setError("発注点は0以上の整数で入力してください");
            return;
        }
        if (priceUnitBlocked) {
            const message =
                "この品目には価格記録があります。単価は基準単位から計算するため、重量は g か kg、体積は mL か L を基準単位にしてください。";
            setFieldErrors({ baseUnit: message });
            setError(message);
            return;
        }
        if (gated && !relabelAck) {
            const message =
                "換算されないことを理解した、にチェックを入れてください";
            setFieldErrors({ relabelAck: message });
            setError(message);
            return;
        }
        // 次元だけの更新は API が拒むため、単位と次元は常に対で送る
        const parsed = itemUpdateSchema.safeParse({
            name,
            categoryId: form.categoryId,
            locationId: form.locationId,
            baseUnit: form.baseUnit.trim(),
            baseDimension: form.baseDimension,
            lowStockThreshold,
            memo: form.memo.trim() || null,
        });
        if (!parsed.success) {
            setFieldErrors(
                fieldErrorsFromIssues(parsed.error.issues, [
                    "name",
                    "categoryId",
                    "locationId",
                    "baseUnit",
                    "baseDimension",
                    "lowStockThreshold",
                    "memo",
                ]),
            );
            setError(
                parsed.error.issues[0]?.message ?? "入力を確認してください",
            );
            return;
        }
        try {
            await updateMutation.mutateAsync(parsed.data);
            // パンくずの末尾は loader が返した品目名なので、改名を反映させるため
            // route も読み直す
            await router.invalidate();
            setSaved(true);
            setRelabelAck(false);
        } catch (cause) {
            setError(errorMessage(cause, "品目を更新できませんでした"));
        }
    };

    return (
        <form className="flex flex-col gap-6" onSubmit={submit}>
            <div aria-live="polite" className="empty:hidden">
                {saved ? (
                    <p className="rounded-lg border bg-muted/50 p-3 text-sm">
                        品目を保存しました。
                    </p>
                ) : null}
            </div>
            {error ? (
                <div
                    aria-live="assertive"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    role="alert"
                >
                    {error}
                </div>
            ) : null}

            <FieldGroup>
                <Field data-invalid={Boolean(fieldErrors.name)}>
                    <FieldLabel htmlFor="item-master-name">品目名</FieldLabel>
                    <Input
                        aria-invalid={Boolean(fieldErrors.name)}
                        autoComplete="off"
                        id="item-master-name"
                        required
                        value={form.name}
                        onChange={(event) => update("name", event.target.value)}
                    />
                    <FieldError>{fieldErrors.name}</FieldError>
                </Field>
                <Field
                    data-invalid={Boolean(fieldErrors.categoryId)}
                    data-disabled={availableCategories.length === 0}
                >
                    <FieldLabel htmlFor="item-master-category">
                        カテゴリ
                    </FieldLabel>
                    <Select
                        items={categoryItems}
                        value={form.categoryId || null}
                        onValueChange={(value) =>
                            update("categoryId", value ?? "")
                        }
                    >
                        <SelectTrigger
                            aria-invalid={Boolean(fieldErrors.categoryId)}
                            className="w-full"
                            disabled={availableCategories.length === 0}
                            id="item-master-category"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={null}>
                                    カテゴリを選択
                                </SelectItem>
                                {availableCategories.map((category) => (
                                    <SelectItem
                                        key={category.id}
                                        value={category.id}
                                    >
                                        {categoryLabels.get(category.id) ??
                                            category.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldDescription>
                        カテゴリの種別（書籍・書類など）は変えられないため、同じ種別のカテゴリだけを選べます。
                    </FieldDescription>
                    <FieldError>{fieldErrors.categoryId}</FieldError>
                </Field>
                <Field
                    data-invalid={Boolean(fieldErrors.locationId)}
                    data-disabled={locations.length === 0}
                >
                    <FieldLabel htmlFor="item-master-location">
                        保管場所
                    </FieldLabel>
                    <Select
                        items={locationItems}
                        value={form.locationId || null}
                        onValueChange={(value) =>
                            update("locationId", value ?? "")
                        }
                    >
                        <SelectTrigger
                            aria-invalid={Boolean(fieldErrors.locationId)}
                            className="w-full"
                            disabled={locations.length === 0}
                            id="item-master-location"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={null}>
                                    保管場所を選択
                                </SelectItem>
                                {locations.map((location) => (
                                    <SelectItem
                                        key={location.id}
                                        value={location.id}
                                    >
                                        {locationLabels.get(location.id) ??
                                            location.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldError>{fieldErrors.locationId}</FieldError>
                </Field>
            </FieldGroup>

            <FieldGroup>
                <Field data-invalid={Boolean(fieldErrors.baseUnit)}>
                    <FieldLabel htmlFor="item-master-base-unit">
                        基準単位
                    </FieldLabel>
                    <Input
                        aria-invalid={Boolean(fieldErrors.baseUnit)}
                        id="item-master-base-unit"
                        placeholder="個、箱、kg など"
                        required
                        value={form.baseUnit}
                        onChange={(event) =>
                            update("baseUnit", event.target.value)
                        }
                    />
                    <FieldDescription>
                        保存済みの数量は換算されません。現在庫、ロット、入出庫履歴、価格の内容量、発注点は同じ数値のまま、意味だけが新しい単位に変わります。
                    </FieldDescription>
                    <FieldError>{fieldErrors.baseUnit}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.baseDimension)}>
                    <FieldLabel htmlFor="item-master-base-dimension">
                        数量の次元
                    </FieldLabel>
                    <Select
                        items={dimensionItems}
                        value={form.baseDimension}
                        onValueChange={(value) =>
                            update(
                                "baseDimension",
                                toBaseDimension(value, item.baseDimension),
                            )
                        }
                    >
                        <SelectTrigger
                            aria-invalid={Boolean(fieldErrors.baseDimension)}
                            className="w-full"
                            id="item-master-base-dimension"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {dimensionItems.map((option) => (
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
                    <FieldDescription>
                        次元を変えるときは基準単位も合わせて指定します（体積へ移したのに単位が
                        g のまま、を防ぐため）。
                    </FieldDescription>
                    <FieldError>{fieldErrors.baseDimension}</FieldError>
                </Field>

                {/* 関門は単位・次元を変えた時点で現れる。挿入だけで読み上げられる
                    よう role="alert" を持たせ、中は入れ子の alert にしない */}
                {gated ? (
                    <div
                        className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                        role="alert"
                    >
                        <p className="font-bold">
                            この品目には、単位の意味が変わる記録があります
                        </p>
                        <p>
                            {relabelSummary(item, impact)}は「{item.baseUnit}（
                            {dimensionLabels[item.baseDimension]}
                            ）」として記録されています。「
                            {form.baseUnit.trim() || "—"}（
                            {dimensionLabels[form.baseDimension]}
                            ）」へ変更しても数値は換算されません。同じ数値が、そのまま新しい単位の値として読まれます。
                        </p>
                        {item.currentQuantity > 0 ? (
                            <p>
                                現在庫{" "}
                                {item.currentQuantity.toLocaleString("ja-JP")}{" "}
                                {item.baseUnit} は、変更後は{" "}
                                {item.currentQuantity.toLocaleString("ja-JP")}{" "}
                                {form.baseUnit.trim() || "—"} を意味します。
                            </p>
                        ) : null}
                        {item.lowStockThreshold !== null ? (
                            <p>
                                発注点{" "}
                                {item.lowStockThreshold.toLocaleString("ja-JP")}{" "}
                                も換算されません。在庫不足の判定が変わるため、下の発注点を入れ直してください。
                            </p>
                        ) : null}
                        <Field
                            data-invalid={Boolean(fieldErrors.relabelAck)}
                            orientation="horizontal"
                        >
                            <Checkbox
                                aria-describedby={
                                    fieldErrors.relabelAck
                                        ? "item-master-relabel-ack-error"
                                        : undefined
                                }
                                aria-invalid={Boolean(fieldErrors.relabelAck)}
                                checked={relabelAck}
                                id="item-master-relabel-ack"
                                onCheckedChange={(checked) => {
                                    setRelabelAck(checked);
                                    setFieldErrors((current) => {
                                        if (!current.relabelAck) return current;
                                        const next = { ...current };
                                        delete next.relabelAck;
                                        return next;
                                    });
                                }}
                            />
                            <FieldContent>
                                <FieldLabel htmlFor="item-master-relabel-ack">
                                    数値が換算されないことを理解した
                                </FieldLabel>
                                {/* この箱が既に role="alert" なので、
                                    FieldError（role="alert"）は入れ子にせず、
                                    aria-describedby でチェックへ結び付ける */}
                                {fieldErrors.relabelAck ? (
                                    <p
                                        className="text-sm font-medium"
                                        id="item-master-relabel-ack-error"
                                    >
                                        {fieldErrors.relabelAck}
                                    </p>
                                ) : null}
                            </FieldContent>
                        </Field>
                    </div>
                ) : null}
            </FieldGroup>

            <FieldGroup>
                <Field data-invalid={Boolean(fieldErrors.lowStockThreshold)}>
                    <FieldLabel htmlFor="item-master-low-stock-threshold">
                        発注点（任意）
                    </FieldLabel>
                    <Input
                        aria-invalid={Boolean(fieldErrors.lowStockThreshold)}
                        id="item-master-low-stock-threshold"
                        min="0"
                        type="number"
                        value={form.lowStockThreshold}
                        onChange={(event) =>
                            update("lowStockThreshold", event.target.value)
                        }
                    />
                    <FieldDescription>
                        基準単位（{form.baseUnit.trim() || "—"}
                        ）での在庫下限です。これを下回ると在庫一覧で在庫不足として出ます。単位をつけ替えても換算されないため、必要ならここで入れ直してください。
                    </FieldDescription>
                    <FieldError>{fieldErrors.lowStockThreshold}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.memo)}>
                    <FieldLabel htmlFor="item-master-memo">
                        メモ（任意）
                    </FieldLabel>
                    <Textarea
                        aria-invalid={Boolean(fieldErrors.memo)}
                        className="min-h-24 resize-y"
                        id="item-master-memo"
                        maxLength={2000}
                        placeholder="補足情報"
                        value={form.memo}
                        onChange={(event) => update("memo", event.target.value)}
                    />
                    <FieldError>{fieldErrors.memo}</FieldError>
                </Field>
            </FieldGroup>

            <div className="flex flex-wrap gap-2">
                <Button disabled={updateMutation.isPending} type="submit">
                    {updateMutation.isPending ? "保存中…" : "変更を保存"}
                </Button>
                <Button
                    disabled={updateMutation.isPending}
                    onClick={() => {
                        setForm(initialForm(item));
                        setFieldErrors({});
                        setError(null);
                        setSaved(false);
                        setRelabelAck(false);
                    }}
                    type="button"
                    variant="outline"
                >
                    入力を元に戻す
                </Button>
            </div>
        </form>
    );
}

/** Select は null を返し得るため、未選択は今の次元のままにする。 */
const toBaseDimension = (
    value: string | null,
    fallback: ItemBaseDimension,
): ItemBaseDimension =>
    value === "mass" || value === "volume" || value === "count"
        ? value
        : fallback;

/** 警告に出す「何が残っているか」。読み手が実物を確かめられる粒度で並べる。 */
const relabelSummary = (
    item: ItemDetailDto,
    impact: ItemRelabelImpact,
): string => {
    const parts: string[] = [];
    if (item.currentQuantity > 0) {
        parts.push(`現在庫 ${item.currentQuantity.toLocaleString("ja-JP")}`);
    }
    if (item.lots.length > 0) {
        parts.push(`ロット ${item.lots.length.toLocaleString("ja-JP")} 件`);
    }
    if (impact.hasStockMovements) parts.push("入出庫履歴");
    if (impact.hasPriceRecords) parts.push("価格記録");
    // 発注点は在庫下限を基準単位で表した値。つけ替えでも入力し直されないため、
    // 残る記録として同じ並びに出す
    if (item.lowStockThreshold !== null) {
        parts.push(`発注点 ${item.lowStockThreshold.toLocaleString("ja-JP")}`);
    }
    return parts.length === 0 ? "保存済みの数量" : parts.join("、");
};
