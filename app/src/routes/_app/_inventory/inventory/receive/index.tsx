import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    createFileRoute,
    type ErrorComponentProps,
    Link,
    useRouter,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { ItemBaseDimension, ItemDto } from "@/domain/item";
import {
    buildReceiptMatchIndex,
    matchLine,
    normalizeReceiptName,
} from "@/domain/receipt-match";
import { parsePositiveInteger, toIsoDateTime } from "@/lib/expiry-input";
import {
    buildHierarchyLabels,
    getEffectiveCategoryKind,
} from "@/lib/hierarchy";
import { createItem } from "./-api/stock-api";
import {
    categoryTreeQueryOptions,
    inventoryKeys,
    itemKeys,
    itemListQueryOptions,
    locationTreeQueryOptions,
    stockHistoryKeys,
} from "./-api/stock-queries";

export const Route = createFileRoute("/_app/_inventory/inventory/receive/")({
    loader: ({ context }) =>
        Promise.all([
            context.queryClient.ensureQueryData(itemListQueryOptions()),
            context.queryClient.ensureQueryData(categoryTreeQueryOptions()),
            context.queryClient.ensureQueryData(locationTreeQueryOptions()),
        ]),
    staticData: {
        breadcrumbs: [{ label: "入庫" }],
    },
    component: ReceiveStockPage,
    pendingComponent: ReceivePending,
    errorComponent: ReceiveError,
});

const pageClassName = "mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8";

type ExpiryMode = "date" | "none";

const expiryModeOptions: { label: string; value: ExpiryMode }[] = [
    { label: "期限を指定する", value: "date" },
    { label: "期限なし", value: "none" },
];

const dimensionOptions: { label: string; value: ItemBaseDimension }[] = [
    { label: "重量", value: "mass" },
    { label: "体積", value: "volume" },
    { label: "個数", value: "count" },
];

const toDimension = (value: string | null): ItemBaseDimension | "" =>
    value === "mass" || value === "volume" || value === "count" ? value : "";

// エラーはコントロールから aria-describedby で辿れるようにする。
// 入力欄ごとに id を組み立て、説明文がある欄では両方を並べる
const errorId = (field: string): string => `receive-${field}-error`;

const describedBy = (
    hasError: boolean,
    field: string,
    descriptionId?: string,
): string | undefined =>
    [hasError ? errorId(field) : null, descriptionId ?? null]
        .filter((value): value is string => value !== null)
        .join(" ") || undefined;

// 同じ物を二重に登録しないため、名前が近い品目を提示する上限
const similarItemLimit = 5;

function ReceiveStockPage() {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { data: items } = useSuspenseQuery(itemListQueryOptions());
    const { data: categories } = useSuspenseQuery(categoryTreeQueryOptions());
    const { data: locations } = useSuspenseQuery(locationTreeQueryOptions());

    const [name, setName] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [locationId, setLocationId] = useState("");
    const [baseUnit, setBaseUnit] = useState("");
    const [baseDimension, setBaseDimension] = useState<ItemBaseDimension | "">(
        "",
    );
    const [quantity, setQuantity] = useState("1");
    const [expiryMode, setExpiryMode] = useState<ExpiryMode>("none");
    const [expiryInput, setExpiryInput] = useState("");
    const [memo, setMemo] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [created, setCreated] = useState<ItemDto | null>(null);

    // 登録は品目・ロット・在庫履歴を一度に作る。在庫一覧と履歴のキャッシュも流す
    const createMutation = useMutation({
        mutationFn: createItem,
        onSuccess: () =>
            Promise.all([
                queryClient.invalidateQueries({ queryKey: itemKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: stockHistoryKeys.all,
                }),
                queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
            ]),
    });
    const saving = createMutation.isPending;

    const categoryLabels = useMemo(
        () => buildHierarchyLabels(categories),
        [categories],
    );
    const locationLabels = useMemo(
        () => buildHierarchyLabels(locations),
        [locations],
    );
    const categoryOptions = useMemo(
        () =>
            categories.map((category) => ({
                label: categoryLabels.get(category.id) ?? category.name,
                value: category.id,
            })),
        [categories, categoryLabels],
    );
    const locationOptions = useMemo(
        () =>
            locations.map((location) => ({
                label: locationLabels.get(location.id) ?? location.name,
                value: location.id,
            })),
        [locations, locationLabels],
    );

    // 書籍などの種別は基準単位を service が補うため、入力を必須にしない
    const effectiveKind = useMemo(
        () => getEffectiveCategoryKind(categoryId || null, categories),
        [categories, categoryId],
    );
    const unitRequired = effectiveKind !== "document";

    // 同じ物が登録済みかを名前で照合する。確定はせず候補として見せるだけで、
    // 反映先は利用者が品目のページで選ぶ（レシート取込と同じ方針）
    const matchIndex = useMemo(() => buildReceiptMatchIndex(items), [items]);
    const nameMatch = useMemo(() => {
        const normalized = normalizeReceiptName(name);
        if (normalized.length === 0) return null;
        return matchLine(
            normalized,
            {
                exact: matchIndex.exact,
                aliases: new Map(),
                candidates: matchIndex.candidates,
            },
            { candidateLimit: similarItemLimit },
        );
    }, [matchIndex, name]);
    const matchedItem = useMemo(
        () =>
            nameMatch?.itemId
                ? (items.find((item) => item.id === nameMatch.itemId) ?? null)
                : null,
        [items, nameMatch],
    );

    const resetFeedback = () => {
        setErrors({});
        setSubmitError(null);
        setCreated(null);
    };

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next: Record<string, string> = {};
        const trimmedName = name.trim();
        if (trimmedName.length === 0) next.name = "品目名を入力してください";
        if (categoryId === "") next.categoryId = "カテゴリを選択してください";
        if (locationId === "") next.locationId = "保管場所を選択してください";
        const parsedQuantity = parsePositiveInteger(quantity);
        if (parsedQuantity === null) {
            next.quantity = "1以上の整数で入力してください";
        }
        // baseUnit と baseDimension は対で送る契約。片方だけでは API が 400 を返す
        if (unitRequired && baseUnit.trim() === "") {
            next.baseUnit = "基準単位を入力してください";
        }
        if (unitRequired && baseDimension === "") {
            next.baseDimension = "数量の種類を選択してください";
        }
        const expiryDate =
            expiryMode === "none" ? null : toIsoDateTime(expiryInput);
        if (expiryMode === "date" && expiryDate === null) {
            next.expiryDate =
                "期限日時を入力するか、「期限なし」を選択してください";
        }
        setErrors(next);
        setSubmitError(null);
        setCreated(null);
        if (Object.keys(next).length > 0) return;

        try {
            const item = await createMutation.mutateAsync({
                name: trimmedName,
                categoryId,
                locationId,
                currentQuantity: parsedQuantity ?? 1,
                ...(expiryDate === null ? {} : { expiryDate }),
                ...(unitRequired && baseDimension !== ""
                    ? { baseUnit: baseUnit.trim(), baseDimension }
                    : {}),
                ...(memo.trim() === "" ? {} : { memo: memo.trim() }),
            });
            setCreated(item);
            setName("");
            setBaseUnit("");
            setBaseDimension("");
            setQuantity("1");
            setExpiryMode("none");
            setExpiryInput("");
            setMemo("");
        } catch (cause) {
            setSubmitError(errorMessage(cause, "品目を登録できませんでした"));
        }
    };

    return (
        <main className={pageClassName}>
            <header>
                <h1 className="mt-1 text-2xl font-bold">入庫</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    まだ登録していない手持ちの物を、品目として作りながら在庫に入れます。
                    登録済みの品目へ足す場合は、
                    <Link
                        className="underline underline-offset-4"
                        to="/inventory"
                    >
                        在庫一覧
                    </Link>
                    から品目のページを開いてください。
                </p>
            </header>

            <section aria-labelledby="receive-form-title">
                <div className="mb-5 flex items-center gap-3">
                    <h2 className="font-bold" id="receive-form-title">
                        手持ちの在庫を登録
                    </h2>
                </div>
                <form
                    className="flex max-w-2xl flex-col gap-5"
                    onSubmit={submit}
                >
                    <FieldGroup>
                        <Field data-invalid={Boolean(errors.name)}>
                            <FieldLabel htmlFor="receive-name">
                                品目名
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy(
                                    Boolean(errors.name),
                                    "name",
                                    "receive-name-description",
                                )}
                                aria-invalid={Boolean(errors.name)}
                                autoComplete="off"
                                disabled={saving}
                                id="receive-name"
                                maxLength={200}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    resetFeedback();
                                }}
                                placeholder="小麦粉、トイレットペーパー など"
                                value={name}
                            />
                            <FieldDescription id="receive-name-description">
                                同じ物が登録済みかどうかを、入力に合わせて下に出します。
                            </FieldDescription>
                            {errors.name ? (
                                <FieldError id={errorId("name")}>
                                    {errors.name}
                                </FieldError>
                            ) : null}
                        </Field>

                        {matchedItem ? (
                            <div
                                aria-live="polite"
                                className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm"
                            >
                                同じ名前の品目が既にあります。こちらへ足す場合は{" "}
                                <Link
                                    className="underline underline-offset-4"
                                    params={{ itemId: matchedItem.id }}
                                    to="/inventory/items/$itemId"
                                >
                                    {matchedItem.name}
                                </Link>{" "}
                                のページで入庫してください。
                            </div>
                        ) : nameMatch && nameMatch.candidates.length > 0 ? (
                            // 候補は打鍵のたびに入れ替わるため読み上げ対象にしない。
                            // 同名が既にある場合の警告だけを live region で伝える
                            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm">
                                <span>
                                    名前の近い品目があります。同じ物ならそちらへ入庫してください。
                                </span>
                                <ul className="flex flex-wrap gap-2">
                                    {nameMatch.candidates.map((candidate) => (
                                        <li key={candidate.itemId}>
                                            <Button
                                                nativeButton={false}
                                                render={
                                                    <Link
                                                        params={{
                                                            itemId: candidate.itemId,
                                                        }}
                                                        to="/inventory/items/$itemId"
                                                    />
                                                }
                                                size="xs"
                                                variant="outline"
                                            >
                                                {candidate.name}（一致度{" "}
                                                {candidate.score}）
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <Field data-invalid={Boolean(errors.categoryId)}>
                            <FieldLabel htmlFor="receive-category">
                                カテゴリ
                            </FieldLabel>
                            <Select
                                disabled={
                                    saving || categoryOptions.length === 0
                                }
                                items={categoryOptions}
                                onValueChange={(value) => {
                                    setCategoryId(value ?? "");
                                    resetFeedback();
                                }}
                                value={categoryId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy(
                                        Boolean(errors.categoryId),
                                        "category",
                                    )}
                                    aria-invalid={Boolean(errors.categoryId)}
                                    className="w-full"
                                    id="receive-category"
                                >
                                    <SelectValue
                                        placeholder={
                                            categoryOptions.length === 0
                                                ? "カテゴリがありません"
                                                : "カテゴリを選択"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {categoryOptions.map((option) => (
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
                            {categoryOptions.length === 0 ? (
                                <FieldDescription>
                                    カテゴリがまだありません。
                                    <Link
                                        className="underline underline-offset-4"
                                        to="/categories"
                                    >
                                        カテゴリ
                                    </Link>
                                    で先に作ってください。
                                </FieldDescription>
                            ) : null}
                            {errors.categoryId ? (
                                <FieldError id={errorId("category")}>
                                    {errors.categoryId}
                                </FieldError>
                            ) : null}
                        </Field>

                        <Field data-invalid={Boolean(errors.locationId)}>
                            <FieldLabel htmlFor="receive-location">
                                保管場所
                            </FieldLabel>
                            <Select
                                disabled={
                                    saving || locationOptions.length === 0
                                }
                                items={locationOptions}
                                onValueChange={(value) => {
                                    setLocationId(value ?? "");
                                    resetFeedback();
                                }}
                                value={locationId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy(
                                        Boolean(errors.locationId),
                                        "location",
                                    )}
                                    aria-invalid={Boolean(errors.locationId)}
                                    className="w-full"
                                    id="receive-location"
                                >
                                    <SelectValue
                                        placeholder={
                                            locationOptions.length === 0
                                                ? "保管場所がありません"
                                                : "保管場所を選択"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {locationOptions.map((option) => (
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
                            {locationOptions.length === 0 ? (
                                <FieldDescription>
                                    保管場所がまだありません。
                                    <Link
                                        className="underline underline-offset-4"
                                        to="/locations"
                                    >
                                        保管場所
                                    </Link>
                                    で先に作ってください。
                                </FieldDescription>
                            ) : null}
                            {errors.locationId ? (
                                <FieldError id={errorId("location")}>
                                    {errors.locationId}
                                </FieldError>
                            ) : null}
                        </Field>

                        {unitRequired ? (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field data-invalid={Boolean(errors.baseUnit)}>
                                    <FieldLabel htmlFor="receive-unit">
                                        基準単位
                                    </FieldLabel>
                                    <Input
                                        aria-describedby={describedBy(
                                            Boolean(errors.baseUnit),
                                            "unit",
                                        )}
                                        aria-invalid={Boolean(errors.baseUnit)}
                                        disabled={saving}
                                        id="receive-unit"
                                        maxLength={50}
                                        onChange={(event) => {
                                            setBaseUnit(event.target.value);
                                            resetFeedback();
                                        }}
                                        placeholder="個、袋、g、ml など"
                                        value={baseUnit}
                                    />
                                    {errors.baseUnit ? (
                                        <FieldError id={errorId("unit")}>
                                            {errors.baseUnit}
                                        </FieldError>
                                    ) : null}
                                </Field>

                                <Field
                                    data-invalid={Boolean(errors.baseDimension)}
                                >
                                    <FieldLabel htmlFor="receive-dimension">
                                        数量の種類
                                    </FieldLabel>
                                    <Select
                                        disabled={saving}
                                        items={dimensionOptions}
                                        onValueChange={(value) => {
                                            setBaseDimension(
                                                toDimension(value),
                                            );
                                            resetFeedback();
                                        }}
                                        value={baseDimension || null}
                                    >
                                        <SelectTrigger
                                            aria-describedby={describedBy(
                                                Boolean(errors.baseDimension),
                                                "dimension",
                                            )}
                                            aria-invalid={Boolean(
                                                errors.baseDimension,
                                            )}
                                            className="w-full"
                                            id="receive-dimension"
                                        >
                                            <SelectValue placeholder="種類を選択" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {dimensionOptions.map(
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
                                    {errors.baseDimension ? (
                                        <FieldError id={errorId("dimension")}>
                                            {errors.baseDimension}
                                        </FieldError>
                                    ) : null}
                                </Field>
                            </div>
                        ) : null}

                        <Field data-invalid={Boolean(errors.quantity)}>
                            <FieldLabel htmlFor="receive-quantity">
                                いまある数量
                                {baseUnit.trim()
                                    ? `（${baseUnit.trim()}）`
                                    : ""}
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy(
                                    Boolean(errors.quantity),
                                    "quantity",
                                )}
                                aria-invalid={Boolean(errors.quantity)}
                                disabled={saving}
                                id="receive-quantity"
                                inputMode="numeric"
                                min={1}
                                onChange={(event) => {
                                    setQuantity(event.target.value);
                                    resetFeedback();
                                }}
                                step={1}
                                type="number"
                                value={quantity}
                            />
                            {errors.quantity ? (
                                <FieldError id={errorId("quantity")}>
                                    {errors.quantity}
                                </FieldError>
                            ) : null}
                        </Field>

                        <Field>
                            <FieldLabel htmlFor="receive-expiry-mode">
                                期限の扱い
                            </FieldLabel>
                            <Select
                                disabled={saving}
                                items={expiryModeOptions}
                                onValueChange={(value) => {
                                    setExpiryMode(
                                        value === "date" ? "date" : "none",
                                    );
                                    resetFeedback();
                                }}
                                value={expiryMode}
                            >
                                <SelectTrigger
                                    className="w-full"
                                    id="receive-expiry-mode"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {expiryModeOptions.map((option) => (
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

                        {expiryMode === "date" ? (
                            <Field data-invalid={Boolean(errors.expiryDate)}>
                                <FieldLabel htmlFor="receive-expiry-date">
                                    期限日時
                                </FieldLabel>
                                <Input
                                    aria-describedby={describedBy(
                                        Boolean(errors.expiryDate),
                                        "expiry",
                                    )}
                                    aria-invalid={Boolean(errors.expiryDate)}
                                    disabled={saving}
                                    id="receive-expiry-date"
                                    onChange={(event) => {
                                        setExpiryInput(event.target.value);
                                        resetFeedback();
                                    }}
                                    type="datetime-local"
                                    value={expiryInput}
                                />
                                {errors.expiryDate ? (
                                    <FieldError id={errorId("expiry")}>
                                        {errors.expiryDate}
                                    </FieldError>
                                ) : null}
                            </Field>
                        ) : null}

                        <Field>
                            <FieldLabel htmlFor="receive-memo">
                                メモ（任意）
                            </FieldLabel>
                            <Textarea
                                disabled={saving}
                                id="receive-memo"
                                maxLength={2000}
                                onChange={(event) => {
                                    setMemo(event.target.value);
                                    resetFeedback();
                                }}
                                rows={2}
                                value={memo}
                            />
                        </Field>
                    </FieldGroup>

                    <div className="flex justify-end gap-2">
                        <Button disabled={saving} type="submit">
                            {saving ? "登録中…" : "品目を登録して在庫に入れる"}
                        </Button>
                    </div>
                </form>
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
            {created ? (
                <output
                    aria-live="polite"
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm"
                >
                    <span>
                        {created.name} を {created.currentQuantity}{" "}
                        {created.baseUnit} で登録しました。
                    </span>
                    <Button
                        onClick={() =>
                            void router.navigate({
                                params: { itemId: created.id },
                                to: "/inventory/items/$itemId",
                            })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        品目のページを開く
                    </Button>
                </output>
            ) : null}
        </main>
    );
}

function ReceivePending() {
    return (
        <main className={pageClassName}>
            <p className="text-sm text-muted-foreground">
                入庫画面を読み込んでいます…
            </p>
        </main>
    );
}

function ReceiveError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    return (
        <main className={pageClassName}>
            <div
                aria-live="assertive"
                className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
                role="alert"
            >
                <span>
                    {errorMessage(error, "入庫画面を読み込めませんでした")}
                </span>
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
