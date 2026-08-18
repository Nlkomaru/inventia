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
import type { ReceiptLineDto } from "@/domain/receipt";
import {
    expiryConfidenceLabels,
    expirySourceLabels,
    matchMethodLabels,
    type ReceiptReviewField,
    type ReceiptReviewNewItemForm,
    type ReceiptReviewRow,
    reviewItemNameMax,
} from "../-functions/receipt-review-form";

export interface SelectOption {
    label: string;
    value: string;
}

const dimensionOptions: SelectOption[] = [
    { label: "重量", value: "mass" },
    { label: "体積", value: "volume" },
    { label: "個数", value: "count" },
];

const toDimension = (value: string | null): "mass" | "volume" | "count" | "" =>
    value === "mass" || value === "volume" || value === "count" ? value : "";

type ReceiptReviewDetailProps = {
    line: ReceiptLineDto;
    row: ReceiptReviewRow;
    issues: Partial<Record<ReceiptReviewField, string>>;
    categoryOptions: SelectOption[];
    locationOptions: SelectOption[];
    disabled: boolean;
    onChange: (patch: Partial<ReceiptReviewRow>) => void;
    onNewItemChange: (patch: Partial<ReceiptReviewNewItemForm>) => void;
};

export function ReceiptReviewDetail({
    line,
    row,
    issues,
    categoryOptions,
    locationOptions,
    disabled,
    onChange,
    onNewItemChange,
}: ReceiptReviewDetailProps) {
    const fieldId = (name: string) => `receipt-line-${row.lineNo}-${name}`;
    const errorId = (name: string) => `${fieldId(name)}-error`;
    const describedBy = (
        field: ReceiptReviewField,
        name: string,
        ...extra: string[]
    ) => {
        const ids = [...extra];
        if (issues[field]) ids.push(errorId(name));
        return ids.length > 0 ? ids.join(" ") : undefined;
    };

    return (
        <div className="flex flex-col gap-4 border-l-2 border-primary/40 bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                    {row.lineNo} 行目の詳細
                </p>
                <p className="text-sm text-muted-foreground">
                    {matchSummary(line)}
                </p>
                <p className="text-sm text-muted-foreground">
                    {expirySummary(line)}
                </p>
            </div>

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
                                            selected ? "secondary" : "outline"
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

            {row.action === "create_item" ? (
                <FieldGroup className="gap-4 rounded-lg border border-dashed border-border bg-card p-3">
                    <Field data-invalid={Boolean(issues.newItemName)}>
                        <FieldLabel htmlFor={fieldId("new-name")}>
                            新しい品目名
                        </FieldLabel>
                        <Input
                            aria-describedby={describedBy(
                                "newItemName",
                                "new-name",
                            )}
                            aria-invalid={Boolean(issues.newItemName)}
                            disabled={disabled}
                            id={fieldId("new-name")}
                            maxLength={reviewItemNameMax}
                            onChange={(event) =>
                                onNewItemChange({ name: event.target.value })
                            }
                            value={row.newItem.name}
                        />
                        {issues.newItemName ? (
                            <FieldError id={errorId("new-name")}>
                                {issues.newItemName}
                            </FieldError>
                        ) : null}
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field data-invalid={Boolean(issues.newItemCategoryId)}>
                            <FieldLabel htmlFor={fieldId("new-category")}>
                                カテゴリ
                            </FieldLabel>
                            <Select
                                disabled={
                                    disabled || categoryOptions.length === 0
                                }
                                items={categoryOptions}
                                onValueChange={(value) =>
                                    onNewItemChange({ categoryId: value ?? "" })
                                }
                                value={row.newItem.categoryId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy(
                                        "newItemCategoryId",
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

                        <Field data-invalid={Boolean(issues.newItemLocationId)}>
                            <FieldLabel htmlFor={fieldId("new-location")}>
                                保管場所
                            </FieldLabel>
                            <Select
                                disabled={
                                    disabled || locationOptions.length === 0
                                }
                                items={locationOptions}
                                onValueChange={(value) =>
                                    onNewItemChange({ locationId: value ?? "" })
                                }
                                value={row.newItem.locationId || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy(
                                        "newItemLocationId",
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
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field data-invalid={Boolean(issues.newItemBaseUnit)}>
                            <FieldLabel htmlFor={fieldId("new-unit")}>
                                基準単位（任意）
                            </FieldLabel>
                            <Input
                                aria-describedby={describedBy(
                                    "newItemBaseUnit",
                                    "new-unit",
                                    fieldId("new-unit-description"),
                                )}
                                aria-invalid={Boolean(issues.newItemBaseUnit)}
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
                            data-invalid={Boolean(issues.newItemBaseDimension)}
                        >
                            <FieldLabel htmlFor={fieldId("new-dimension")}>
                                数量の次元（任意）
                            </FieldLabel>
                            <Select
                                disabled={disabled}
                                items={dimensionOptions}
                                onValueChange={(value) =>
                                    onNewItemChange({
                                        baseDimension: toDimension(value),
                                    })
                                }
                                value={row.newItem.baseDimension || null}
                            >
                                <SelectTrigger
                                    aria-describedby={describedBy(
                                        "newItemBaseDimension",
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
                                        {dimensionOptions.map((option) => (
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
                            {issues.newItemBaseDimension ? (
                                <FieldError id={errorId("new-dimension")}>
                                    {issues.newItemBaseDimension}
                                </FieldError>
                            ) : null}
                        </Field>
                    </div>

                    <Field>
                        <FieldLabel htmlFor={fieldId("new-memo")}>
                            メモ（任意）
                        </FieldLabel>
                        <textarea
                            className="min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
                            disabled={disabled}
                            id={fieldId("new-memo")}
                            maxLength={2000}
                            onChange={(event) =>
                                onNewItemChange({ memo: event.target.value })
                            }
                            value={row.newItem.memo}
                        />
                    </Field>
                </FieldGroup>
            ) : null}

            {row.action === "skip" ? null : (
                <Field orientation="horizontal">
                    <input
                        checked={row.registerAlias}
                        className="size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled}
                        id={fieldId("alias")}
                        onChange={(event) =>
                            onChange({ registerAlias: event.target.checked })
                        }
                        type="checkbox"
                    />
                    <FieldLabel htmlFor={fieldId("alias")}>
                        このレシート表記を次回以降の照合に使う
                    </FieldLabel>
                </Field>
            )}
        </div>
    );
}

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
