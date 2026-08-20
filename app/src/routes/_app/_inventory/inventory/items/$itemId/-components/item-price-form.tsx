import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
    Field,
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
import type { ItemDetailDto } from "@/domain/item";
import { type PriceContentUnit, priceContentUnitSchema } from "@/domain/price";
import { parsePositiveInteger, toIsoFromDate } from "@/lib/expiry-input";
import {
    itemPriceRecordKeys,
    storeOptionsQueryOptions,
} from "../-api/item-detail-queries";
import {
    type CreatePriceRecordInput,
    createPriceRecord,
} from "../-api/item-stock-api";

// 店舗を選ばない選択肢の値。Select は空文字を未選択として扱うため別の値にする
const noStoreValue = "__none__";

const errorMessage = (cause: unknown, fallback: string): string =>
    cause instanceof Error ? cause.message : fallback;

const todayInputValue = (): string => {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
};

/**
 * 内容量に選べる単位。基準単位へ整数で換算できる組み合わせだけを出す。
 * 個数は換算しないため基準単位そのものしか使えない（domain の
 * normalizeContentAmount と同じ規則）。
 */
const contentUnitOptions = (item: ItemDetailDto): PriceContentUnit[] => {
    if (item.baseDimension === "mass") {
        return ["g", "kg"];
    }
    if (item.baseDimension === "volume") {
        return ["mL", "L"];
    }
    const parsed = priceContentUnitSchema.safeParse(item.baseUnit);
    return parsed.success ? [parsed.data] : [];
};

/**
 * この品目の価格を 1 件記録する。単価は保存せず読み出し時に計算されるため、
 * ここでは「1 個あたりの内容量 × セット数」と価格だけを受け取る。
 * 店舗を選ぶと店名が取得元として転記される。
 */
export function ItemPriceForm({ item }: { item: ItemDetailDto }) {
    const queryClient = useQueryClient();
    const storesQuery = useQuery(storeOptionsQueryOptions());
    const units = useMemo(() => contentUnitOptions(item), [item]);
    const unitItems = useMemo(
        () => units.map((unit) => ({ label: unit, value: unit })),
        [units],
    );
    const storeItems = useMemo(
        () => [
            { label: "選ばない（取得元を入力）", value: noStoreValue },
            ...(storesQuery.data ?? []).map((store) => ({
                label: store.name,
                value: store.id,
            })),
        ],
        [storesQuery.data],
    );
    const [contentAmount, setContentAmount] = useState("");
    const [contentUnit, setContentUnit] = useState<PriceContentUnit | "">(
        () => units[0] ?? "",
    );
    const [setCount, setSetCount] = useState("1");
    const [price, setPrice] = useState("");
    const [packaging, setPackaging] = useState("");
    const [storeId, setStoreId] = useState(noStoreValue);
    const [source, setSource] = useState("");
    const [recordedAt, setRecordedAt] = useState(todayInputValue);
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: (input: CreatePriceRecordInput) =>
            createPriceRecord(item.id, input),
        onSuccess: () =>
            queryClient.invalidateQueries({
                queryKey: itemPriceRecordKeys.item(item.id),
            }),
    });

    // 個数の品目で基準単位が価格の単位表に無い場合、API が単位を受け付けられない。
    // 送って 400 にするより、理由をその場で示して入力を止める
    if (units.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                この品目の基準単位（{item.baseUnit}
                ）は価格の内容量単位として扱えないため、ここから価格を記録できません。
            </p>
        );
    }

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setFieldError(null);
        setSubmitError(null);
        setNotice(null);
        const amount = parsePositiveInteger(contentAmount);
        const count = parsePositiveInteger(setCount);
        const priceValue = Number(price.trim());
        const recordedAtIso = toIsoFromDate(recordedAt);
        if (amount === null) {
            setFieldError("内容量は 1 以上の整数で入力してください");
            return;
        }
        if (count === null) {
            setFieldError("セット数は 1 以上の整数で入力してください");
            return;
        }
        if (
            price.trim() === "" ||
            !Number.isSafeInteger(priceValue) ||
            priceValue < 0
        ) {
            setFieldError("価格は 0 以上の整数で入力してください");
            return;
        }
        if (recordedAtIso === null) {
            setFieldError("記録日を正しく入力してください");
            return;
        }
        const trimmedSource = source.trim();
        const selectedStoreId = storeId === noStoreValue ? null : storeId;
        if (selectedStoreId === null && trimmedSource === "") {
            setFieldError("店舗を選ぶか、取得元を入力してください");
            return;
        }
        try {
            await mutation.mutateAsync({
                contentAmount: amount,
                contentUnit,
                setCount: count,
                price: priceValue,
                packaging: packaging.trim() === "" ? null : packaging.trim(),
                storeId: selectedStoreId,
                // 店舗を選んだときは service が店名を転記するため送らない
                ...(selectedStoreId === null
                    ? { source: trimmedSource }
                    : trimmedSource === ""
                      ? {}
                      : { source: trimmedSource }),
                recordedAt: recordedAtIso,
            });
            setNotice("価格を記録しました");
            setContentAmount("");
            setSetCount("1");
            setPrice("");
            setPackaging("");
        } catch (cause) {
            setSubmitError(errorMessage(cause, "価格を記録できませんでした"));
        }
    };

    return (
        <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                    <FieldLabel htmlFor="price-content-amount">
                        1 個あたりの内容量
                    </FieldLabel>
                    <Input
                        id="price-content-amount"
                        inputMode="numeric"
                        onChange={(event) =>
                            setContentAmount(event.target.value)
                        }
                        value={contentAmount}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-content-unit">単位</FieldLabel>
                    <Select
                        items={unitItems}
                        onValueChange={(value) => {
                            const next = units.find(
                                (unit) => unit === String(value),
                            );
                            if (next) setContentUnit(next);
                        }}
                        value={contentUnit}
                    >
                        <SelectTrigger id="price-content-unit">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {units.map((unit) => (
                                    <SelectItem key={unit} value={unit}>
                                        {unit}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-set-count">セット数</FieldLabel>
                    <Input
                        id="price-set-count"
                        inputMode="numeric"
                        onChange={(event) => setSetCount(event.target.value)}
                        value={setCount}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-value">価格（円）</FieldLabel>
                    <Input
                        id="price-value"
                        inputMode="numeric"
                        onChange={(event) => setPrice(event.target.value)}
                        value={price}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-store">店舗</FieldLabel>
                    <Select
                        items={storeItems}
                        onValueChange={(value) => setStoreId(String(value))}
                        value={storeId}
                    >
                        <SelectTrigger id="price-store">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value={noStoreValue}>
                                    選ばない（取得元を入力）
                                </SelectItem>
                                {(storesQuery.data ?? []).map((store) => (
                                    <SelectItem key={store.id} value={store.id}>
                                        {store.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-recorded-at">記録日</FieldLabel>
                    <DatePicker
                        calendarLabel="記録日をカレンダーから選ぶ"
                        id="price-recorded-at"
                        onValueChange={setRecordedAt}
                        value={recordedAt}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-source">
                        取得元（店舗を選ばない場合）
                    </FieldLabel>
                    <Input
                        id="price-source"
                        onChange={(event) => setSource(event.target.value)}
                        placeholder="Amazon など"
                        value={source}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor="price-packaging">包装</FieldLabel>
                    <Input
                        id="price-packaging"
                        onChange={(event) => setPackaging(event.target.value)}
                        placeholder="ボトル、詰め替えなど"
                        value={packaging}
                    />
                </Field>
            </FieldGroup>

            <FieldError>{fieldError ?? submitError}</FieldError>
            {notice === null ? null : (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                    {notice}
                </p>
            )}

            <div>
                <Button disabled={mutation.isPending} type="submit">
                    {mutation.isPending ? "記録中…" : "価格を記録"}
                </Button>
            </div>
        </form>
    );
}
