import { Button } from "@/components/ui/button";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet,
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
import type { ReceiptLineDto } from "@/domain/receipt";
import { formatYen } from "../../-functions/receipt-format";
import {
    actionLabels,
    expiryConfidenceLabels,
    expirySourceLabels,
    matchMethodLabels,
    type ReceiptReviewAction,
    type ReceiptReviewField,
    type ReceiptReviewNewItemForm,
    type ReceiptReviewRow,
    reviewItemNameMax,
    reviewQuantityMax,
} from "../-functions/receipt-review-form";

export interface SelectOption {
    label: string;
    value: string;
}

const actionOptions: SelectOption[] = (
    ["add_to_item", "create_item", "skip"] as const
).map((action) => ({ label: actionLabels[action], value: action }));

const expiryModeOptions: SelectOption[] = [
    { label: "この期限で入庫する", value: "date" },
    { label: "期限なし", value: "none" },
];

const dimensionOptions: SelectOption[] = [
    { label: "重量", value: "mass" },
    { label: "体積", value: "volume" },
    { label: "個数", value: "count" },
];

const isAction = (value: string | null): value is ReceiptReviewAction =>
    value === "add_to_item" || value === "create_item" || value === "skip";

type ReceiptReviewLineProps = {
    line: ReceiptLineDto;
    row: ReceiptReviewRow;
    itemOptions: SelectOption[];
    categoryOptions: SelectOption[];
    locationOptions: SelectOption[];
    issues: Partial<Record<ReceiptReviewField, string>>;
    disabled: boolean;
    onChange: (patch: Partial<ReceiptReviewRow>) => void;
    onNewItemChange: (patch: Partial<ReceiptReviewNewItemForm>) => void;
};

export function ReceiptReviewLine({
    line,
    row,
    itemOptions,
    categoryOptions,
    locationOptions,
    issues,
    disabled,
    onChange,
    onNewItemChange,
}: ReceiptReviewLineProps) {
    const fieldId = (name: string) => `receipt-line-${row.lineNo}-${name}`;
    const errorId = (name: string) => `${fieldId(name)}-error`;
    const describedBy = (name: string, ...extra: string[]) => {
        const ids = [...extra];
        if (issues[nameToField(name)]) ids.push(errorId(name));
        return ids.length > 0 ? ids.join(" ") : undefined;
    };

    return (
        <li className="rounded-xl border border-border bg-card p-4">
            <FieldSet className="gap-4">
                <FieldLegend className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                        {row.lineNo} 行目
                    </span>
                    {/* 長い商品名でも折り返して崩さない */}
                    <span className="break-words text-base font-semibold">
                        {row.rawName}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                        レシート表記: {line.quantity} 点 /{" "}
                        {formatYen(line.price)}
                    </span>
                </FieldLegend>

                <FieldGroup className="gap-4">
                    <Field>
                        <FieldLabel htmlFor={fieldId("action")}>
                            反映方法
                        </FieldLabel>
                        <Select
                            disabled={disabled}
                            items={actionOptions}
                            onValueChange={(value) => {
                                if (isAction(value))
                                    onChange({ action: value });
                            }}
                            value={row.action}
                        >
                            <SelectTrigger
                                className="w-full"
                                id={fieldId("action")}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {actionOptions.map((option) => (
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
                            {matchSummary(line)}
                        </FieldDescription>
                    </Field>

                    {line.candidates.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <p
                                className="text-sm text-muted-foreground"
                                id={fieldId("candidates")}
                            >
                                照合候補（名前が似ているだけの候補は自動で確定しません）
                            </p>
                            <ul
                                aria-labelledby={fieldId("candidates")}
                                className="flex flex-wrap gap-2"
                            >
                                {line.candidates.map((candidate) => {
                                    const selected =
                                        row.action === "add_to_item" &&
                                        row.itemId === candidate.itemId;
                                    return (
                                        <li key={candidate.itemId}>
                                            <Button
                                                aria-pressed={selected}
                                                disabled={disabled}
                                                onClick={() =>
                                                    onChange({
                                                        action: "add_to_item",
                                                        itemId: candidate.itemId,
                                                    })
                                                }
                                                size="sm"
                                                type="button"
                                                variant={
                                                    selected
                                                        ? "secondary"
                                                        : "outline"
                                                }
                                            >
                                                <span className="max-w-56 truncate">
                                                    {candidate.name}
                                                </span>
                                                <span className="text-muted-foreground">
                                                    一致度 {candidate.score}
                                                </span>
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ) : null}

                    {row.action === "add_to_item" ? (
                        <Field data-invalid={Boolean(issues.itemId)}>
                            <FieldLabel htmlFor={fieldId("item")}>
                                反映先の品目
                            </FieldLabel>
                            <Select
                                disabled={disabled || itemOptions.length === 0}
                                items={itemOptions}
                                onValueChange={(value) =>
                                    onChange({ itemId: value ?? "" })
                                }
                                value={row.itemId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy("item")}
                                    aria-invalid={Boolean(issues.itemId)}
                                    className="w-full"
                                    id={fieldId("item")}
                                >
                                    <SelectValue placeholder="品目を選択" />
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
                            {issues.itemId ? (
                                <FieldError id={errorId("item")}>
                                    {issues.itemId}
                                </FieldError>
                            ) : null}
                        </Field>
                    ) : null}

                    {row.action === "create_item" ? (
                        <FieldGroup className="gap-4 rounded-lg border border-dashed border-border p-3">
                            <Field data-invalid={Boolean(issues.newItemName)}>
                                <FieldLabel htmlFor={fieldId("new-name")}>
                                    新しい品目名
                                </FieldLabel>
                                <Input
                                    aria-describedby={describedBy("new-name")}
                                    aria-invalid={Boolean(issues.newItemName)}
                                    disabled={disabled}
                                    id={fieldId("new-name")}
                                    maxLength={reviewItemNameMax}
                                    onChange={(event) =>
                                        onNewItemChange({
                                            name: event.target.value,
                                        })
                                    }
                                    value={row.newItem.name}
                                />
                                {issues.newItemName ? (
                                    <FieldError id={errorId("new-name")}>
                                        {issues.newItemName}
                                    </FieldError>
                                ) : null}
                            </Field>
                            <Field
                                data-invalid={Boolean(issues.newItemCategoryId)}
                            >
                                <FieldLabel htmlFor={fieldId("new-category")}>
                                    カテゴリ
                                </FieldLabel>
                                <Select
                                    disabled={
                                        disabled || categoryOptions.length === 0
                                    }
                                    items={categoryOptions}
                                    onValueChange={(value) =>
                                        onNewItemChange({
                                            categoryId: value ?? "",
                                        })
                                    }
                                    value={row.newItem.categoryId || null}
                                >
                                    <SelectTrigger
                                        aria-describedby={describedBy(
                                            "new-category",
                                        )}
                                        aria-invalid={Boolean(
                                            issues.newItemCategoryId,
                                        )}
                                        className="w-full"
                                        id={fieldId("new-category")}
                                    >
                                        <SelectValue placeholder="カテゴリを選択" />
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
                                {issues.newItemCategoryId ? (
                                    <FieldError id={errorId("new-category")}>
                                        {issues.newItemCategoryId}
                                    </FieldError>
                                ) : null}
                            </Field>
                            <Field
                                data-invalid={Boolean(issues.newItemLocationId)}
                            >
                                <FieldLabel htmlFor={fieldId("new-location")}>
                                    保管場所
                                </FieldLabel>
                                <Select
                                    disabled={
                                        disabled || locationOptions.length === 0
                                    }
                                    items={locationOptions}
                                    onValueChange={(value) =>
                                        onNewItemChange({
                                            locationId: value ?? "",
                                        })
                                    }
                                    value={row.newItem.locationId || null}
                                >
                                    <SelectTrigger
                                        aria-describedby={describedBy(
                                            "new-location",
                                        )}
                                        aria-invalid={Boolean(
                                            issues.newItemLocationId,
                                        )}
                                        className="w-full"
                                        id={fieldId("new-location")}
                                    >
                                        <SelectValue placeholder="保管場所を選択" />
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
                                {issues.newItemLocationId ? (
                                    <FieldError id={errorId("new-location")}>
                                        {issues.newItemLocationId}
                                    </FieldError>
                                ) : null}
                            </Field>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field
                                    data-invalid={Boolean(
                                        issues.newItemBaseUnit,
                                    )}
                                >
                                    <FieldLabel htmlFor={fieldId("new-unit")}>
                                        基準単位（任意）
                                    </FieldLabel>
                                    <Input
                                        aria-describedby={describedBy(
                                            "new-unit",
                                            fieldId("new-unit-description"),
                                        )}
                                        aria-invalid={Boolean(
                                            issues.newItemBaseUnit,
                                        )}
                                        disabled={disabled}
                                        id={fieldId("new-unit")}
                                        onChange={(event) =>
                                            onNewItemChange({
                                                baseUnit: event.target.value,
                                            })
                                        }
                                        placeholder="個、袋、g など"
                                        value={row.newItem.baseUnit}
                                    />
                                    <FieldDescription
                                        id={fieldId("new-unit-description")}
                                    >
                                        空欄にすると既定の単位で登録します。
                                    </FieldDescription>
                                    {issues.newItemBaseUnit ? (
                                        <FieldError id={errorId("new-unit")}>
                                            {issues.newItemBaseUnit}
                                        </FieldError>
                                    ) : null}
                                </Field>
                                <Field
                                    data-invalid={Boolean(
                                        issues.newItemBaseDimension,
                                    )}
                                >
                                    <FieldLabel
                                        htmlFor={fieldId("new-dimension")}
                                    >
                                        数量の次元（任意）
                                    </FieldLabel>
                                    <Select
                                        disabled={disabled}
                                        items={dimensionOptions}
                                        onValueChange={(value) =>
                                            onNewItemChange({
                                                baseDimension:
                                                    toDimension(value),
                                            })
                                        }
                                        value={
                                            row.newItem.baseDimension || null
                                        }
                                    >
                                        <SelectTrigger
                                            aria-describedby={describedBy(
                                                "new-dimension",
                                            )}
                                            aria-invalid={Boolean(
                                                issues.newItemBaseDimension,
                                            )}
                                            className="w-full"
                                            id={fieldId("new-dimension")}
                                        >
                                            <SelectValue placeholder="次元を選択" />
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
                                    {issues.newItemBaseDimension ? (
                                        <FieldError
                                            id={errorId("new-dimension")}
                                        >
                                            {issues.newItemBaseDimension}
                                        </FieldError>
                                    ) : null}
                                </Field>
                            </div>
                        </FieldGroup>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field data-invalid={Boolean(issues.quantity)}>
                            <FieldLabel htmlFor={fieldId("quantity")}>
                                数量
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy("quantity")}
                                aria-invalid={Boolean(issues.quantity)}
                                disabled={disabled || row.action === "skip"}
                                id={fieldId("quantity")}
                                inputMode="numeric"
                                max={reviewQuantityMax}
                                min={1}
                                onChange={(event) =>
                                    onChange({ quantity: event.target.value })
                                }
                                step={1}
                                type="number"
                                value={row.quantity}
                            />
                            {issues.quantity ? (
                                <FieldError id={errorId("quantity")}>
                                    {issues.quantity}
                                </FieldError>
                            ) : null}
                        </Field>
                        <Field data-invalid={Boolean(issues.price)}>
                            <FieldLabel htmlFor={fieldId("price")}>
                                金額（円）
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy(
                                    "price",
                                    fieldId("price-description"),
                                )}
                                aria-invalid={Boolean(issues.price)}
                                disabled={disabled || row.action === "skip"}
                                id={fieldId("price")}
                                inputMode="numeric"
                                min={0}
                                onChange={(event) =>
                                    onChange({ price: event.target.value })
                                }
                                step={1}
                                type="number"
                                value={row.price}
                            />
                            <FieldDescription id={fieldId("price-description")}>
                                空欄にすると金額なしとして扱い、価格履歴を残しません。
                            </FieldDescription>
                            {issues.price ? (
                                <FieldError id={errorId("price")}>
                                    {issues.price}
                                </FieldError>
                            ) : null}
                        </Field>
                    </div>

                    <Field>
                        <FieldLabel htmlFor={fieldId("expiry-mode")}>
                            期限の扱い
                        </FieldLabel>
                        <Select
                            disabled={disabled || row.action === "skip"}
                            items={expiryModeOptions}
                            onValueChange={(value) =>
                                onChange({
                                    expiryMode:
                                        value === "none" ? "none" : "date",
                                })
                            }
                            value={row.expiryMode}
                        >
                            <SelectTrigger
                                aria-describedby={fieldId("expiry-description")}
                                className="w-full"
                                id={fieldId("expiry-mode")}
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
                        <FieldDescription id={fieldId("expiry-description")}>
                            {expirySummary(line)}
                        </FieldDescription>
                    </Field>

                    {row.expiryMode === "date" ? (
                        <Field data-invalid={Boolean(issues.expiryDate)}>
                            <FieldLabel htmlFor={fieldId("expiry-date")}>
                                期限（年月日）
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy("expiry-date")}
                                aria-invalid={Boolean(issues.expiryDate)}
                                disabled={disabled || row.action === "skip"}
                                id={fieldId("expiry-date")}
                                onChange={(event) =>
                                    onChange({ expiryDate: event.target.value })
                                }
                                type="date"
                                value={row.expiryDate}
                            />
                            {issues.expiryDate ? (
                                <FieldError id={errorId("expiry-date")}>
                                    {issues.expiryDate}
                                </FieldError>
                            ) : null}
                        </Field>
                    ) : null}

                    {row.action === "skip" ? null : (
                        <Field orientation="horizontal">
                            <input
                                checked={row.registerAlias}
                                className="size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={disabled}
                                id={fieldId("alias")}
                                onChange={(event) =>
                                    onChange({
                                        registerAlias: event.target.checked,
                                    })
                                }
                                type="checkbox"
                            />
                            <FieldLabel htmlFor={fieldId("alias")}>
                                このレシート表記を次回以降の照合に使う
                            </FieldLabel>
                        </Field>
                    )}
                </FieldGroup>
            </FieldSet>
        </li>
    );
}

const nameToField = (name: string): ReceiptReviewField => {
    switch (name) {
        case "item":
            return "itemId";
        case "quantity":
            return "quantity";
        case "price":
            return "price";
        case "expiry-date":
            return "expiryDate";
        case "new-name":
            return "newItemName";
        case "new-category":
            return "newItemCategoryId";
        case "new-location":
            return "newItemLocationId";
        case "new-unit":
            return "newItemBaseUnit";
        default:
            return "newItemBaseDimension";
    }
};

const toDimension = (value: string | null): "mass" | "volume" | "count" | "" =>
    value === "mass" || value === "volume" || value === "count" ? value : "";

/** 照合の根拠を 1 行で示す。確定済みの行は候補が空になる。 */
const matchSummary = (line: ReceiptLineDto): string => {
    if (line.matchedItemId === null) {
        return line.candidates.length === 0
            ? "一致する品目が見つかりませんでした。取り込む場合は品目を選ぶか、新規作成してください。"
            : "候補は見つかりましたが自動では確定していません。反映先を選んでください。";
    }
    const method =
        line.matchMethod === null
            ? "照合済み"
            : matchMethodLabels[line.matchMethod];
    const score = line.matchScore === null ? "" : `・一致度 ${line.matchScore}`;
    return `${method}${score}: ${line.matchedItemName ?? line.matchedItemId}`;
};

/** 期限の初期値がどこから来たかを示す。推測は根拠と確度も出す。 */
const expirySummary = (line: ReceiptLineDto): string => {
    const parts = [`由来: ${expirySourceLabels[line.expirySource]}`];
    if (line.expiryConfidence !== null) {
        parts.push(expiryConfidenceLabels[line.expiryConfidence]);
    }
    if (line.expiryEstimateReason !== null) {
        parts.push(`根拠: ${line.expiryEstimateReason}`);
    }
    if (line.expirySource === "unknown") {
        parts.push("推測できなかったため初期値は「期限なし」です。");
    }
    return parts.join(" / ");
};
