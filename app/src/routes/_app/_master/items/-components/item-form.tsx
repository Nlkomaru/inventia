import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { CategoryDto } from "@/domain/category";
import {
    type ItemCreateInput,
    type ItemDto,
    type ItemUpdateInput,
    itemCreateSchema,
    itemUpdateSchema,
} from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import {
    type ReadingStateDto,
    type ReadingStateUpsertInput,
    type ReadingStatus,
    readingStatuses,
} from "@/domain/reading";
import { toIsoFromDate } from "@/lib/expiry-input";
import {
    buildHierarchyLabels,
    getEffectiveCategoryKind,
} from "@/lib/hierarchy";
import {
    type ReadingStateChange,
    readingStateFormValues,
    readingStatusLabels,
    resolveReadingStateChange,
} from "@/lib/reading-input";

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
    readingStatus: ReadingStatus | "";
    readingStartedAt: string;
    readingFinishedAt: string;
};

type FieldErrors = Partial<Record<keyof FormValues, string>>;

type ItemFormProps = {
    open: boolean;
    item: ItemDto | null;
    /** 編集対象に保存済みの読書状態。取得前と未設定はどちらも null。 */
    readingState: ReadingStateDto | null;
    readingStateLoading?: boolean;
    categories: CategoryDto[];
    locations: LocationDto[];
    onOpenChange: (open: boolean) => void;
    onCreate: (
        input: ItemCreateInput,
        readingState: ReadingStateUpsertInput | null,
    ) => Promise<void>;
    onUpdate: (
        id: string,
        input: ItemUpdateInput,
        readingState: ReadingStateChange,
    ) => Promise<void>;
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
    readingStatus: "",
    readingStartedAt: "",
    readingFinishedAt: "",
};

const dimensionLabels: Record<BaseDimension, string> = {
    mass: "重量",
    volume: "体積",
    count: "個数",
};

const readingStatusItems = [
    { label: "未設定", value: null },
    ...readingStatuses.map((status) => ({
        label: readingStatusLabels[status],
        value: status,
    })),
];

const toReadingStatus = (value: string | null): ReadingStatus | "" =>
    readingStatuses.find((status) => status === value) ?? "";

const parseNullableInteger = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
};

const initialForm = (
    item: ItemDto | null,
    readingState: ReadingStateDto | null,
): FormValues => {
    if (!item) return { ...emptyForm, ...readingStateFormValues(readingState) };
    return {
        ...readingStateFormValues(readingState),
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
    readingState,
    readingStateLoading = false,
    categories,
    locations,
    onOpenChange,
    onCreate,
    onUpdate,
}: ItemFormProps) {
    const [form, setForm] = useState<FormValues>(() =>
        initialForm(item, readingState),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const selectedCategory = useMemo(
        () => categories.find((category) => category.id === form.categoryId),
        [categories, form.categoryId],
    );
    const categoryLabels = useMemo(
        () => buildHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => buildHierarchyLabels(locations),
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
    // 読書状態は実効カテゴリー種別が book の品目だけが持つ。
    // 欄を出さない品目では、残っている読書状態にも触らない
    const readingEnabled = effectiveCategoryKind === "book";
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

    // 読書状態は品目より遅れて届くため、ここでは空にしておき次の効果で入れる
    useEffect(() => {
        if (!open) return;
        setForm(initialForm(item, null));
        setError(null);
        setFieldErrors({});
    }, [item, open]);

    // 遅れて届いた読書状態は、入力中の他の欄を巻き戻さないよう読書欄だけへ反映する
    useEffect(() => {
        if (!open) return;
        setForm((current) => ({
            ...current,
            ...readingStateFormValues(readingState),
        }));
    }, [open, readingState]);

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

    // 状態を選び直したときは、その状態で持てない日付を空へ戻す
    const updateReadingStatus = (value: ReadingStatus | "") => {
        setForm((current) => ({
            ...current,
            readingStatus: value,
            readingStartedAt:
                value === "" || value === "unread"
                    ? ""
                    : current.readingStartedAt,
            readingFinishedAt:
                value === "finished" ? current.readingFinishedAt : "",
        }));
        setFieldErrors((current) => {
            const next = { ...current };
            delete next.readingStatus;
            delete next.readingStartedAt;
            delete next.readingFinishedAt;
            return next;
        });
    };

    const resolveReading = () =>
        readingEnabled
            ? resolveReadingStateChange(
                  {
                      readingStatus: form.readingStatus,
                      readingStartedAt: form.readingStartedAt,
                      readingFinishedAt: form.readingFinishedAt,
                  },
                  readingState,
              )
            : ({ ok: true, change: { kind: "unchanged" } } as const);

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
        const reading = resolveReading();
        if (!reading.ok) {
            const readingErrors: FieldErrors = {};
            readingErrors[reading.field] = reading.message;
            setFieldErrors(readingErrors);
            setError(reading.message);
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
                await onUpdate(item.id, parsed.data, reading.change);
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

        if (form.expiryDate && !toIsoFromDate(form.expiryDate)) {
            setFieldErrors({
                expiryDate: "期限を 2020-01-01 の形式で入力してください",
            });
            setError("期限を 2020-01-01 の形式で入力してください");
            return;
        }
        const expiryDate = toIsoFromDate(form.expiryDate);
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
            await onCreate(
                parsed.data,
                reading.change.kind === "set" ? reading.change.input : null,
            );
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
                                    基準単位
                                </FieldLabel>
                                <Input
                                    disabled
                                    id="item-base-unit-readonly"
                                    value={form.baseUnit}
                                />
                                {/* 単位と次元は品目ページで変更できる。ここは
                                    保存済みの値の確認だけに留め、送信もしない */}
                                <FieldDescription>
                                    このダイアログでは変更しません。変更は
                                    <Link
                                        className="underline underline-offset-4"
                                        params={{ itemId: item.id }}
                                        to="/items/$itemId"
                                    >
                                        品目ページ
                                    </Link>
                                    から行います。
                                </FieldDescription>
                            </Field>
                            <Field data-disabled>
                                <FieldLabel htmlFor="item-base-dimension-readonly">
                                    次元
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
                                <FieldDescription>
                                    次元も品目ページで基準単位と合わせて変更します。
                                </FieldDescription>
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
                    ) : isDocument ? null : (
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

                    {readingEnabled ? (
                        <FieldGroup>
                            <Field
                                data-disabled={readingStateLoading}
                                data-invalid={Boolean(
                                    fieldErrors.readingStatus,
                                )}
                            >
                                <FieldLabel htmlFor="item-reading-status">
                                    読書状態
                                </FieldLabel>
                                <Select
                                    items={readingStatusItems}
                                    value={form.readingStatus || null}
                                    onValueChange={(value) =>
                                        updateReadingStatus(
                                            toReadingStatus(value),
                                        )
                                    }
                                >
                                    <SelectTrigger
                                        aria-invalid={Boolean(
                                            fieldErrors.readingStatus,
                                        )}
                                        className="w-full"
                                        disabled={readingStateLoading}
                                        id="item-reading-status"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {readingStatusItems.map(
                                                (option) => (
                                                    <SelectItem
                                                        key={
                                                            option.value ??
                                                            "none"
                                                        }
                                                        value={option.value}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <FieldDescription>
                                    {readingStateLoading
                                        ? "保存済みの読書状態を読み込み中です。"
                                        : "未設定を選ぶと保存済みの読書状態を削除します。"}
                                </FieldDescription>
                                <FieldError>
                                    {fieldErrors.readingStatus}
                                </FieldError>
                            </Field>
                            <Field
                                data-disabled={
                                    readingStateLoading ||
                                    form.readingStatus === "" ||
                                    form.readingStatus === "unread"
                                }
                                data-invalid={Boolean(
                                    fieldErrors.readingStartedAt,
                                )}
                            >
                                <FieldLabel htmlFor="item-reading-started-at">
                                    開始日（任意）
                                </FieldLabel>
                                <DatePicker
                                    aria-invalid={Boolean(
                                        fieldErrors.readingStartedAt,
                                    )}
                                    calendarLabel="開始日をカレンダーから選ぶ"
                                    disabled={
                                        readingStateLoading ||
                                        form.readingStatus === "" ||
                                        form.readingStatus === "unread"
                                    }
                                    id="item-reading-started-at"
                                    onValueChange={(value) =>
                                        update("readingStartedAt", value)
                                    }
                                    value={form.readingStartedAt}
                                />
                                <FieldError>
                                    {fieldErrors.readingStartedAt}
                                </FieldError>
                            </Field>
                            <Field
                                data-disabled={
                                    readingStateLoading ||
                                    form.readingStatus !== "finished"
                                }
                                data-invalid={Boolean(
                                    fieldErrors.readingFinishedAt,
                                )}
                            >
                                <FieldLabel htmlFor="item-reading-finished-at">
                                    読了日（任意）
                                </FieldLabel>
                                <DatePicker
                                    aria-invalid={Boolean(
                                        fieldErrors.readingFinishedAt,
                                    )}
                                    calendarLabel="読了日をカレンダーから選ぶ"
                                    disabled={
                                        readingStateLoading ||
                                        form.readingStatus !== "finished"
                                    }
                                    id="item-reading-finished-at"
                                    onValueChange={(value) =>
                                        update("readingFinishedAt", value)
                                    }
                                    value={form.readingFinishedAt}
                                />
                                <FieldError>
                                    {fieldErrors.readingFinishedAt}
                                </FieldError>
                            </Field>
                        </FieldGroup>
                    ) : null}

                    <FieldGroup>
                        {item ? null : (
                            <Field
                                data-invalid={Boolean(fieldErrors.expiryDate)}
                            >
                                <FieldLabel htmlFor="item-expiry-date">
                                    初期ロットの期限（任意）
                                </FieldLabel>
                                <DatePicker
                                    aria-invalid={Boolean(
                                        fieldErrors.expiryDate,
                                    )}
                                    calendarLabel="初期ロットの期限をカレンダーから選ぶ"
                                    id="item-expiry-date"
                                    onValueChange={(value) =>
                                        update("expiryDate", value)
                                    }
                                    value={form.expiryDate}
                                />
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
                            <Textarea
                                aria-invalid={Boolean(fieldErrors.memo)}
                                className="min-h-24 resize-y"
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
                    <Button
                        disabled={saving || readingStateLoading}
                        form="item-form"
                        type="submit"
                    >
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
