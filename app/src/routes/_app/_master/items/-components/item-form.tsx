import { type FormEvent, useEffect, useMemo, useState } from "react";
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
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDto,
    type ItemUpdateInput,
    itemCreateSchema,
    itemUpdateSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import { getEffectiveCategoryKind, getHierarchyLabels } from "./item-options";

type BaseDimension = "mass" | "volume" | "count";

type FormValues = {
    name: string;
    categoryId: string;
    locationId: string;
    baseUnit: string;
    baseDimension: BaseDimension | "";
    currentQuantity: string;
    expiryDate: string;
    lowStockThreshold: string;
    memo: string;
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;

type ItemFormProps = {
    open: boolean;
    item: ItemDto | null;
    categories: CategoryDto[];
    locations: LocationDto[];
    onOpenChange: (open: boolean) => void;
    onCreate: (input: ItemCreateInput) => Promise<void>;
    onUpdate: (id: string, input: ItemUpdateInput) => Promise<void>;
};

const emptyForm: FormValues = {
    name: "",
    categoryId: "",
    locationId: "",
    baseUnit: "",
    baseDimension: "",
    currentQuantity: "0",
    expiryDate: "",
    lowStockThreshold: "",
    memo: "",
};

const dimensionLabels: Record<BaseDimension, string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

const toIsoDateTime = (value: string): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
};

const parseNullableInteger = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
};

const initialForm = (item: ItemDto | null): FormValues => {
    if (!item) return emptyForm;
    return {
        name: item.name,
        categoryId: item.categoryId,
        locationId: item.locationId,
        baseUnit: item.baseUnit,
        baseDimension: item.baseDimension,
        currentQuantity: String(item.currentQuantity),
        // 期限はロット単位で管理するため、編集フォームでは扱わない
        expiryDate: "",
        lowStockThreshold:
            item.lowStockThreshold === null
                ? ""
                : String(item.lowStockThreshold),
        memo: item.memo ?? "",
    };
};

const fieldErrorsFromIssues = (
    issues: readonly { message: string; path: PropertyKey[] }[],
): FieldErrors => {
    const errors: FieldErrors = {};
    for (const issue of issues) {
        const field = issue.path[0];
        if (typeof field === "string" && field in emptyForm) {
            errors[field as keyof FormValues] ??= issue.message;
        }
    }
    return errors;
};

export function ItemForm({
    open,
    item,
    categories,
    locations,
    onOpenChange,
    onCreate,
    onUpdate,
}: ItemFormProps) {
    const [form, setForm] = useState<FormValues>(() => initialForm(item));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const selectedCategory = useMemo(
        () => categories.find((category) => category.id === form.categoryId),
        [categories, form.categoryId],
    );
    const categoryLabels = useMemo(
        () => getHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => getHierarchyLabels(locations),
        [locations],
    );
    const effectiveCategoryKind = useMemo(
        () =>
            getEffectiveCategoryKind(selectedCategory?.id ?? null, categories),
        [categories, selectedCategory],
    );
    const editingCategoryKind = useMemo(
        () =>
            item ? getEffectiveCategoryKind(item.categoryId, categories) : null,
        [categories, item],
    );
    const isDocument = effectiveCategoryKind === "document";
    const availableCategories = useMemo(
        () =>
            item
                ? categories.filter(
                      (category) =>
                          getEffectiveCategoryKind(category.id, categories) ===
                          editingCategoryKind,
                  )
                : categories,
        [categories, editingCategoryKind, item],
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

    useEffect(() => {
        if (!open) return;
        setForm(initialForm(item));
        setError(null);
        setFieldErrors({});
    }, [item, open]);

    const update = <K extends keyof FormValues>(
        key: K,
        value: FormValues[K],
    ) => {
        setForm((current) => ({ ...current, [key]: value }));
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
        const lowStockThreshold = parseNullableInteger(form.lowStockThreshold);
        if (form.lowStockThreshold.trim() && lowStockThreshold === null) {
            setFieldErrors({
                lowStockThreshold: "発注点は0以上の整数で入力してください",
            });
            setError("発注点は0以上の整数で入力してください");
            return;
        }
        if (item) {
            // itemUpdateSchema は strict で expiryDate を受け付けない
            const parsed = itemUpdateSchema.safeParse({
                name,
                categoryId: form.categoryId,
                locationId: form.locationId,
                lowStockThreshold,
                memo: form.memo.trim() || null,
            });
            if (!parsed.success) {
                setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
                setError(
                    parsed.error.issues[0]?.message ?? "入力を確認してください",
                );
                return;
            }
            setSaving(true);
            try {
                await onUpdate(item.id, parsed.data);
                onOpenChange(false);
            } catch (cause) {
                setError(
                    cause instanceof Error
                        ? cause.message
                        : "保存できませんでした",
                );
            } finally {
                setSaving(false);
            }
            return;
        }

        if (form.expiryDate && !toIsoDateTime(form.expiryDate)) {
            setFieldErrors({ expiryDate: "期限日時を正しく入力してください" });
            setError("期限日時を正しく入力してください");
            return;
        }
        const expiryDate = toIsoDateTime(form.expiryDate);
        const currentQuantity = parseNullableInteger(form.currentQuantity);
        if (!isDocument && (!form.baseUnit.trim() || !form.baseDimension)) {
            const errors: FieldErrors = {};
            if (!form.baseUnit.trim())
                errors.baseUnit = "基準単位を入力してください";
            if (!form.baseDimension) {
                errors.baseDimension = "数量の次元を選択してください";
            }
            setFieldErrors(errors);
            setError("単位と数量の次元を入力してください");
            return;
        }
        if (!isDocument && currentQuantity === null) {
            setFieldErrors({
                currentQuantity: "初期数量は0以上の整数で入力してください",
            });
            setError("初期数量は0以上の整数で入力してください");
            return;
        }
        const parsed = itemCreateSchema.safeParse({
            name,
            categoryId: form.categoryId,
            locationId: form.locationId,
            expiryDate,
            lowStockThreshold,
            memo: form.memo.trim() || null,
            ...(isDocument
                ? {}
                : {
                      baseUnit: form.baseUnit.trim(),
                      baseDimension: form.baseDimension,
                      currentQuantity,
                  }),
        });
        if (!parsed.success) {
            setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
            setError(
                parsed.error.issues[0]?.message ?? "入力を確認してください",
            );
            return;
        }
        setSaving(true);
        try {
            await onCreate(parsed.data);
            onOpenChange(false);
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "保存できませんでした",
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>
                        {item ? "品目を編集" : "品目を登録"}
                    </SheetTitle>
                    <SheetDescription>
                        {item
                            ? "表示情報と保管場所を更新します。単位と在庫数量は変更できません。期限は在庫画面のロット操作で変更します。"
                            : "在庫として管理する品目の基本情報を入力します。"}
                    </SheetDescription>
                </SheetHeader>
                <form
                    className="flex flex-1 flex-col gap-5 px-4"
                    id="item-form"
                    onSubmit={submit}
                >
                    {error ? <FieldError>{error}</FieldError> : null}
                    <FieldGroup>
                        <Field data-invalid={Boolean(fieldErrors.name)}>
                            <FieldLabel htmlFor="item-name">品目名</FieldLabel>
                            <Input
                                aria-invalid={Boolean(fieldErrors.name)}
                                autoComplete="off"
                                id="item-name"
                                required
                                value={form.name}
                                onChange={(event) =>
                                    update("name", event.target.value)
                                }
                            />
                            <FieldError>{fieldErrors.name}</FieldError>
                        </Field>
                        <Field
                            data-invalid={Boolean(fieldErrors.categoryId)}
                            data-disabled={availableCategories.length === 0}
                        >
                            <FieldLabel htmlFor="item-category">
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
                                    aria-invalid={Boolean(
                                        fieldErrors.categoryId,
                                    )}
                                    className="w-full"
                                    id="item-category"
                                    disabled={availableCategories.length === 0}
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
                                                {categoryLabels.get(
                                                    category.id,
                                                ) ?? category.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldError>{fieldErrors.categoryId}</FieldError>
                        </Field>
                        <Field
                            data-invalid={Boolean(fieldErrors.locationId)}
                            data-disabled={locations.length === 0}
                        >
                            <FieldLabel htmlFor="item-location">
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
                                    aria-invalid={Boolean(
                                        fieldErrors.locationId,
                                    )}
                                    className="w-full"
                                    id="item-location"
                                    disabled={locations.length === 0}
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
                                                {locationLabels.get(
                                                    location.id,
                                                ) ?? location.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldError>{fieldErrors.locationId}</FieldError>
                        </Field>
                    </FieldGroup>

                    {item ? (
                        <FieldGroup>
                            <Field data-disabled>
                                <FieldLabel htmlFor="item-base-unit-readonly">
                                    基準単位（変更不可）
                                </FieldLabel>
                                <Input
                                    disabled
                                    id="item-base-unit-readonly"
                                    value={form.baseUnit}
                                />
                            </Field>
                            <Field data-disabled>
                                <FieldLabel htmlFor="item-base-dimension-readonly">
                                    次元（変更不可）
                                </FieldLabel>
                                <Input
                                    disabled
                                    id="item-base-dimension-readonly"
                                    value={
                                        form.baseDimension
                                            ? dimensionLabels[
                                                  form.baseDimension
                                              ]
                                            : ""
                                    }
                                />
                            </Field>
                            <Field data-disabled>
                                <FieldLabel htmlFor="item-current-quantity-readonly">
                                    現在庫（変更不可）
                                </FieldLabel>
                                <Input
                                    disabled
                                    id="item-current-quantity-readonly"
                                    value={form.currentQuantity}
                                />
                            </Field>
                        </FieldGroup>
                    ) : isDocument ? (
                        <Field>
                            <FieldLabel>文書の数量</FieldLabel>
                            <FieldDescription>
                                文書カテゴリはサービスの既定値（1件・count）を使用します。
                            </FieldDescription>
                        </Field>
                    ) : (
                        <FieldGroup>
                            <Field data-invalid={Boolean(fieldErrors.baseUnit)}>
                                <FieldLabel htmlFor="item-base-unit">
                                    基準単位
                                </FieldLabel>
                                <Input
                                    id="item-base-unit"
                                    placeholder="個、箱、kg など"
                                    required
                                    value={form.baseUnit}
                                    onChange={(event) =>
                                        update("baseUnit", event.target.value)
                                    }
                                />
                                <FieldError>{fieldErrors.baseUnit}</FieldError>
                            </Field>
                            <Field
                                data-invalid={Boolean(
                                    fieldErrors.baseDimension,
                                )}
                            >
                                <FieldLabel htmlFor="item-base-dimension">
                                    数量の次元
                                </FieldLabel>
                                <Select
                                    items={[
                                        { label: "次元を選択", value: null },
                                        ...Object.entries(dimensionLabels).map(
                                            ([value, label]) => ({
                                                value,
                                                label,
                                            }),
                                        ),
                                    ]}
                                    value={form.baseDimension || null}
                                    onValueChange={(value) =>
                                        update(
                                            "baseDimension",
                                            (value ?? "") as BaseDimension | "",
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        aria-invalid={Boolean(
                                            fieldErrors.baseDimension,
                                        )}
                                        className="w-full"
                                        id="item-base-dimension"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value={null}>
                                                次元を選択
                                            </SelectItem>
                                            {Object.entries(
                                                dimensionLabels,
                                            ).map(([value, label]) => (
                                                <SelectItem
                                                    key={value}
                                                    value={value}
                                                >
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <FieldError>
                                    {fieldErrors.baseDimension}
                                </FieldError>
                            </Field>
                            <Field
                                data-invalid={Boolean(
                                    fieldErrors.currentQuantity,
                                )}
                            >
                                <FieldLabel htmlFor="item-current-quantity">
                                    初期数量
                                </FieldLabel>
                                <Input
                                    id="item-current-quantity"
                                    min="0"
                                    aria-invalid={Boolean(
                                        fieldErrors.currentQuantity,
                                    )}
                                    required
                                    type="number"
                                    value={form.currentQuantity}
                                    onChange={(event) =>
                                        update(
                                            "currentQuantity",
                                            event.target.value,
                                        )
                                    }
                                />
                                <FieldError>
                                    {fieldErrors.currentQuantity}
                                </FieldError>
                            </Field>
                        </FieldGroup>
                    )}

                    <FieldGroup>
                        {item ? null : (
                            <Field
                                data-invalid={Boolean(fieldErrors.expiryDate)}
                            >
                                <FieldLabel htmlFor="item-expiry-date">
                                    初期ロットの期限（任意）
                                </FieldLabel>
                                <Input
                                    aria-invalid={Boolean(
                                        fieldErrors.expiryDate,
                                    )}
                                    id="item-expiry-date"
                                    type="datetime-local"
                                    value={form.expiryDate}
                                    onChange={(event) =>
                                        update("expiryDate", event.target.value)
                                    }
                                />
                                <FieldDescription>
                                    登録時に作る最初のロットの期限です。入力した日時は
                                    UTC の ISO 8601
                                    形式で保存します。以後の期限は在庫画面のロット操作で変更します。
                                </FieldDescription>
                                <FieldError>
                                    {fieldErrors.expiryDate}
                                </FieldError>
                            </Field>
                        )}
                        <Field
                            data-invalid={Boolean(
                                fieldErrors.lowStockThreshold,
                            )}
                        >
                            <FieldLabel htmlFor="item-low-stock-threshold">
                                発注点（任意）
                            </FieldLabel>
                            <Input
                                aria-invalid={Boolean(
                                    fieldErrors.lowStockThreshold,
                                )}
                                id="item-low-stock-threshold"
                                min="0"
                                type="number"
                                value={form.lowStockThreshold}
                                onChange={(event) =>
                                    update(
                                        "lowStockThreshold",
                                        event.target.value,
                                    )
                                }
                            />
                            <FieldError>
                                {fieldErrors.lowStockThreshold}
                            </FieldError>
                        </Field>
                        <Field data-invalid={Boolean(fieldErrors.memo)}>
                            <FieldLabel htmlFor="item-memo">
                                メモ（任意）
                            </FieldLabel>
                            <textarea
                                aria-invalid={Boolean(fieldErrors.memo)}
                                className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
                                id="item-memo"
                                maxLength={2000}
                                placeholder="補足情報"
                                value={form.memo}
                                onChange={(event) =>
                                    update("memo", event.target.value)
                                }
                            />
                            <FieldError>{fieldErrors.memo}</FieldError>
                        </Field>
                    </FieldGroup>
                </form>
                <SheetFooter>
                    <Button disabled={saving} form="item-form" type="submit">
                        {saving ? "保存中…" : item ? "変更を保存" : "登録する"}
                    </Button>
                    <Button
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                        type="button"
                        variant="outline"
                    >
                        取消
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
