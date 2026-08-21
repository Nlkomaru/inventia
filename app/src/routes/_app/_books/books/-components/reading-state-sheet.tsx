import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field";
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
import type { BookReadingItemDto } from "@/domain/item";
import { type ReadingStatus, readingStatuses } from "@/domain/reading";
import {
    type ReadingStateChange,
    type ReadingStateFormField,
    type ReadingStateFormValues,
    readingStateFormValues,
    readingStatusLabels,
    resolveReadingStateChange,
} from "@/lib/reading-input";

type FieldErrors = Partial<Record<ReadingStateFormField, string>>;

const statusItems = [
    { label: "未設定", value: null },
    ...readingStatuses.map((status) => ({
        label: readingStatusLabels[status],
        value: status,
    })),
];

const toReadingStatus = (value: string | null): ReadingStatus | "" =>
    readingStatuses.find((status) => status === value) ?? "";

const emptyValues: ReadingStateFormValues = {
    readingStatus: "",
    readingStartedAt: "",
    readingFinishedAt: "",
};

type ReadingStateSheetProps = {
    open: boolean;
    /** 編集対象。シートを閉じるまで前の書籍を保つため null を許す。 */
    book: BookReadingItemDto | null;
    onOpenChange: (open: boolean) => void;
    onSave: (itemId: string, change: ReadingStateChange) => Promise<void>;
};

export function ReadingStateSheet({
    open,
    book,
    onOpenChange,
    onSave,
}: ReadingStateSheetProps) {
    const [form, setForm] = useState<ReadingStateFormValues>(emptyValues);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // 一覧の行が読書状態まで持っているため、開くときに追加の取得はしない
    const readingState = book?.readingState ?? null;
    useEffect(() => {
        if (!open) return;
        setForm(readingStateFormValues(readingState));
        setFieldErrors({});
        setError(null);
    }, [open, readingState]);

    const update = (field: ReadingStateFormField, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
        setFieldErrors((current) => {
            const next = { ...current };
            delete next[field];
            return next;
        });
    };

    // 日付は状態と矛盾できないため、状態を変えたときに残せない日付を落とす。
    // 保存時に弾くより、選び直しの手間が少ない
    const updateStatus = (value: ReadingStatus | "") => {
        setForm((current) => ({
            readingStatus: value,
            readingStartedAt:
                value === "" || value === "unread"
                    ? ""
                    : current.readingStartedAt,
            readingFinishedAt:
                value === "finished" ? current.readingFinishedAt : "",
        }));
        setFieldErrors({});
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!book) return;
        setError(null);
        const resolved = resolveReadingStateChange(form, readingState);
        if (!resolved.ok) {
            setFieldErrors({ [resolved.field]: resolved.message });
            setError(resolved.message);
            return;
        }
        if (resolved.change.kind === "unchanged") {
            onOpenChange(false);
            return;
        }
        setSaving(true);
        try {
            await onSave(book.id, resolved.change);
            onOpenChange(false);
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : "保存できませんでした",
            );
        } finally {
            setSaving(false);
        }
    };

    const datesDisabled =
        form.readingStatus === "" || form.readingStatus === "unread";

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                    <SheetTitle>
                        {book ? `${book.name}の読書状態` : "読書状態"}
                    </SheetTitle>
                </SheetHeader>
                <form
                    className="flex flex-1 flex-col gap-5 px-4"
                    id="reading-state-form"
                    onSubmit={(event) => void submit(event)}
                >
                    {error ? <FieldError>{error}</FieldError> : null}
                    <FieldGroup>
                        <Field
                            data-invalid={Boolean(fieldErrors.readingStatus)}
                        >
                            <FieldLabel htmlFor="reading-status">
                                読書状態
                            </FieldLabel>
                            <Select
                                items={statusItems}
                                value={form.readingStatus || null}
                                onValueChange={(value) =>
                                    updateStatus(toReadingStatus(value))
                                }
                            >
                                <SelectTrigger
                                    aria-invalid={Boolean(
                                        fieldErrors.readingStatus,
                                    )}
                                    className="w-full"
                                    id="reading-status"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {statusItems.map((option) => (
                                            <SelectItem
                                                key={option.value ?? "none"}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldDescription>
                                未設定を選ぶと保存済みの読書状態を削除します。
                            </FieldDescription>
                            <FieldError>{fieldErrors.readingStatus}</FieldError>
                        </Field>
                        <Field
                            data-disabled={datesDisabled}
                            data-invalid={Boolean(fieldErrors.readingStartedAt)}
                        >
                            <FieldLabel htmlFor="reading-started-at">
                                開始日（任意）
                            </FieldLabel>
                            <DatePicker
                                aria-invalid={Boolean(
                                    fieldErrors.readingStartedAt,
                                )}
                                calendarLabel="開始日をカレンダーから選ぶ"
                                disabled={datesDisabled}
                                id="reading-started-at"
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
                            data-disabled={form.readingStatus !== "finished"}
                            data-invalid={Boolean(
                                fieldErrors.readingFinishedAt,
                            )}
                        >
                            <FieldLabel htmlFor="reading-finished-at">
                                読了日（任意）
                            </FieldLabel>
                            <DatePicker
                                aria-invalid={Boolean(
                                    fieldErrors.readingFinishedAt,
                                )}
                                calendarLabel="読了日をカレンダーから選ぶ"
                                disabled={form.readingStatus !== "finished"}
                                id="reading-finished-at"
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
                </form>
                <SheetFooter>
                    <Button
                        disabled={saving || book === null}
                        form="reading-state-form"
                        type="submit"
                    >
                        {saving ? "保存中…" : "保存する"}
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
