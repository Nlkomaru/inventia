import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import type { CategoryDto } from "@/domain/category";
import type { ItemDto } from "@/domain/item";
import type { LocationDto } from "@/domain/location";
import type { PriceRecordDimension } from "@/domain/price";
import type { PriceResearchRequestDto } from "@/domain/priceResearch";
import type { StoreDto } from "@/domain/store";
import {
    useCancelPriceResearchMutation,
    useCompletePriceResearchMutation,
} from "../-api/price-research-queries";

interface PendingResearchRowProps {
    request: PriceResearchRequestDto;
    items: ItemDto[];
    stores: StoreDto[];
    categories: CategoryDto[];
    locations: LocationDto[];
}

const dimensionLabels: Record<PriceRecordDimension, string> = {
    mass: "質量 (g / kg)",
    volume: "体積 (mL / L)",
    count: "個数",
};

const inferInitialDimension = (unit: string | null): PriceRecordDimension => {
    if (!unit) return "count";
    const lower = unit.toLowerCase();
    if (lower === "g" || lower === "kg") return "mass";
    if (lower === "ml" || lower === "l") return "volume";
    return "count";
};

export function PendingResearchRow({
    request,
    items,
    stores,
    categories,
    locations,
}: PendingResearchRowProps) {
    const initialUnit = request.item?.baseUnit ?? request.requestedUnit ?? "";

    const [contentAmount, setContentAmount] = useState("");
    const [contentUnit, setContentUnit] = useState(initialUnit);
    const [setCount, setSetCount] = useState("1");
    const [price, setPrice] = useState("");
    const [storeId, setStoreId] = useState("");
    const [packaging, setPackaging] = useState("");
    const [url, setUrl] = useState("");
    const [showOptional, setShowOptional] = useState(false);

    // 未紐付け依頼の品目解決状態
    const [itemMode, setItemMode] = useState<"existing" | "new">(
        items.length > 0 ? "existing" : "new",
    );
    const [selectedItemId, setSelectedItemId] = useState("");
    const [newItemName, setNewItemName] = useState(request.requestedItemName);
    const [newCategoryId, setNewCategoryId] = useState(categories[0]?.id ?? "");
    const [newLocationId, setNewLocationId] = useState(locations[0]?.id ?? "");
    const [newBaseUnit, setNewBaseUnit] = useState(
        request.requestedUnit ?? "個",
    );
    const [newBaseDimension, setNewBaseDimension] =
        useState<PriceRecordDimension>(
            inferInitialDimension(request.requestedUnit),
        );

    const [rowError, setRowError] = useState<string | null>(null);

    const completeMutation = useCompletePriceResearchMutation();
    const cancelMutation = useCancelPriceResearchMutation();

    const selectedStore = stores.find((store) => store.id === storeId);
    const selectedExistingItem = items.find(
        (item) => item.id === selectedItemId,
    );
    const selectedCategory = categories.find(
        (category) => category.id === newCategoryId,
    );
    const selectedLocation = locations.find(
        (location) => location.id === newLocationId,
    );

    const handleSelectExistingItem = (value: string | null) => {
        const nextId = value ?? "";
        setSelectedItemId(nextId);
        const found = items.find((item) => item.id === nextId);
        if (found && contentUnit.trim().length === 0) {
            setContentUnit(found.baseUnit);
        }
    };

    const handleComplete = async () => {
        setRowError(null);

        const parsedAmount = Number.parseInt(contentAmount, 10);
        const parsedSetCount = Number.parseInt(setCount, 10);
        const parsedPrice = Number.parseInt(price, 10);

        if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
            setRowError("内容量は 1 以上の整数を入力してください");
            return;
        }
        if (contentUnit.trim().length === 0) {
            setRowError("単位を入力してください");
            return;
        }
        if (!Number.isSafeInteger(parsedSetCount) || parsedSetCount <= 0) {
            setRowError("セット数は 1 以上の整数を入力してください");
            return;
        }
        if (!Number.isSafeInteger(parsedPrice) || parsedPrice < 0) {
            setRowError("価格は 0 以上の整数を入力してください");
            return;
        }
        if (storeId.trim().length === 0) {
            setRowError("店舗を選択してください");
            return;
        }

        let itemResolution:
            | { itemId: string }
            | {
                  newItem: {
                      name: string;
                      categoryId: string;
                      locationId: string;
                      baseUnit: string;
                      baseDimension: PriceRecordDimension;
                  };
              }
            | Record<string, never> = {};

        if (request.itemId === null) {
            if (itemMode === "existing") {
                if (selectedItemId.trim().length === 0) {
                    setRowError("紐付ける品目を選択してください");
                    return;
                }
                itemResolution = { itemId: selectedItemId };
            } else {
                if (
                    newItemName.trim().length === 0 ||
                    newCategoryId.trim().length === 0 ||
                    newLocationId.trim().length === 0 ||
                    newBaseUnit.trim().length === 0
                ) {
                    setRowError(
                        "新規品目の名前・カテゴリ・保管場所・基準単位を入力してください",
                    );
                    return;
                }
                itemResolution = {
                    newItem: {
                        name: newItemName.trim(),
                        categoryId: newCategoryId,
                        locationId: newLocationId,
                        baseUnit: newBaseUnit.trim(),
                        baseDimension: newBaseDimension,
                    },
                };
            }
        }

        try {
            await completeMutation.mutateAsync({
                id: request.id,
                input: {
                    contentAmount: parsedAmount,
                    contentUnit: contentUnit.trim(),
                    setCount: parsedSetCount,
                    price: parsedPrice,
                    storeId,
                    ...(packaging.trim().length > 0
                        ? { packaging: packaging.trim() }
                        : {}),
                    ...(url.trim().length > 0 ? { url: url.trim() } : {}),
                    ...itemResolution,
                },
            });
        } catch (cause) {
            setRowError(
                cause instanceof Error
                    ? cause.message
                    : "価格の登録に失敗しました",
            );
        }
    };

    const handleCancel = async () => {
        setRowError(null);
        try {
            await cancelMutation.mutateAsync(request.id);
        } catch (cause) {
            setRowError(
                cause instanceof Error
                    ? cause.message
                    : "キャンセルに失敗しました",
            );
        }
    };

    const isBusy = completeMutation.isPending || cancelMutation.isPending;

    return (
        <TableRow className="align-top">
            <TableCell className="min-w-52 space-y-2">
                {request.itemId !== null ? (
                    <div>
                        <Link
                            className="font-medium underline-offset-4 hover:underline"
                            params={{ itemId: request.itemId }}
                            to="/inventory/items/$itemId"
                        >
                            {request.requestedItemName}
                        </Link>
                        {request.item ? (
                            <p className="text-xs text-muted-foreground">
                                基準単位: {request.item.baseUnit}
                            </p>
                        ) : null}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="font-medium">
                                {request.requestedItemName}
                            </span>
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                                未紐付け
                            </span>
                        </div>
                        <div className="flex gap-1">
                            <Button
                                onClick={() => setItemMode("existing")}
                                size="xs"
                                type="button"
                                variant={
                                    itemMode === "existing"
                                        ? "secondary"
                                        : "ghost"
                                }
                            >
                                既存品目
                            </Button>
                            <Button
                                onClick={() => setItemMode("new")}
                                size="xs"
                                type="button"
                                variant={
                                    itemMode === "new" ? "secondary" : "ghost"
                                }
                            >
                                新規作成
                            </Button>
                        </div>
                        {itemMode === "existing" ? (
                            <Select
                                onValueChange={handleSelectExistingItem}
                                value={selectedItemId}
                            >
                                <SelectTrigger className="w-full" size="sm">
                                    <SelectValue>
                                        {selectedExistingItem
                                            ? `${selectedExistingItem.name} (${selectedExistingItem.baseUnit})`
                                            : "品目を選択…"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {items.map((item) => (
                                        <SelectItem
                                            key={item.id}
                                            value={item.id}
                                        >
                                            {item.name} ({item.baseUnit})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="space-y-1.5 rounded-md border p-2 text-xs">
                                <Input
                                    aria-label="新規品目名"
                                    className="h-7 text-xs"
                                    onChange={(event) =>
                                        setNewItemName(event.target.value)
                                    }
                                    placeholder="品目名"
                                    value={newItemName}
                                />
                                <Select
                                    onValueChange={(value) =>
                                        setNewCategoryId(value ?? "")
                                    }
                                    value={newCategoryId}
                                >
                                    <SelectTrigger className="w-full" size="sm">
                                        <SelectValue>
                                            {selectedCategory?.name ??
                                                "カテゴリ"}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map((category) => (
                                            <SelectItem
                                                key={category.id}
                                                value={category.id}
                                            >
                                                {category.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    onValueChange={(value) =>
                                        setNewLocationId(value ?? "")
                                    }
                                    value={newLocationId}
                                >
                                    <SelectTrigger className="w-full" size="sm">
                                        <SelectValue>
                                            {selectedLocation?.name ??
                                                "保管場所"}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {locations.map((location) => (
                                            <SelectItem
                                                key={location.id}
                                                value={location.id}
                                            >
                                                {location.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <Input
                                        aria-label="基準単位"
                                        className="h-7 text-xs"
                                        onChange={(event) =>
                                            setNewBaseUnit(event.target.value)
                                        }
                                        placeholder="単位 (g, 個)"
                                        value={newBaseUnit}
                                    />
                                    <Select
                                        onValueChange={(value) => {
                                            if (
                                                value === "mass" ||
                                                value === "volume" ||
                                                value === "count"
                                            ) {
                                                setNewBaseDimension(value);
                                            }
                                        }}
                                        value={newBaseDimension}
                                    >
                                        <SelectTrigger
                                            className="w-full"
                                            size="sm"
                                        >
                                            <SelectValue>
                                                {
                                                    dimensionLabels[
                                                        newBaseDimension
                                                    ]
                                                }
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="mass">
                                                {dimensionLabels.mass}
                                            </SelectItem>
                                            <SelectItem value="volume">
                                                {dimensionLabels.volume}
                                            </SelectItem>
                                            <SelectItem value="count">
                                                {dimensionLabels.count}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </TableCell>

            <TableCell className="min-w-44 space-y-1 text-xs">
                {request.purpose ? (
                    <p className="font-medium text-foreground">
                        {request.purpose}
                    </p>
                ) : null}
                {request.note ? (
                    <p className="whitespace-pre-wrap text-muted-foreground">
                        {request.note}
                    </p>
                ) : null}
                {request.requestedUnit ? (
                    <p className="text-muted-foreground">
                        希望単位: {request.requestedUnit}
                    </p>
                ) : null}
                {request.requestedBy ? (
                    <p className="text-muted-foreground">
                        依頼元: {request.requestedBy}
                    </p>
                ) : null}
            </TableCell>

            <TableCell className="min-w-48 space-y-1.5">
                <div className="flex items-center gap-1.5">
                    <Input
                        aria-label="内容量"
                        className="h-8 w-20 tabular-nums"
                        min={1}
                        onChange={(event) =>
                            setContentAmount(event.target.value)
                        }
                        placeholder="内容量"
                        type="number"
                        value={contentAmount}
                    />
                    <Input
                        aria-label="単位"
                        className="h-8 w-16"
                        onChange={(event) => setContentUnit(event.target.value)}
                        placeholder="単位"
                        value={contentUnit}
                    />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input
                        aria-label="セット数"
                        className="h-8 w-14 tabular-nums"
                        min={1}
                        onChange={(event) => setSetCount(event.target.value)}
                        placeholder="個数"
                        type="number"
                        value={setCount}
                    />
                </div>
            </TableCell>

            <TableCell className="min-w-48 space-y-1.5">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">¥</span>
                    <Input
                        aria-label="価格 (円)"
                        className="h-8 w-24 tabular-nums"
                        min={0}
                        onChange={(event) => setPrice(event.target.value)}
                        placeholder="価格"
                        type="number"
                        value={price}
                    />
                    <Select
                        onValueChange={(value) => setStoreId(value ?? "")}
                        value={storeId}
                    >
                        <SelectTrigger className="w-36" size="sm">
                            <SelectValue>
                                {selectedStore?.name ?? "店舗を選択"}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {stores.map((store) => (
                                <SelectItem key={store.id} value={store.id}>
                                    {store.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <button
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        onClick={() => setShowOptional((prev) => !prev)}
                        type="button"
                    >
                        {showOptional ? "補足入力を隠す" : "包装・URL を追加"}
                    </button>
                    {showOptional ? (
                        <div className="mt-1.5 space-y-1.5">
                            <Input
                                aria-label="包装・規格"
                                className="h-7 text-xs"
                                onChange={(event) =>
                                    setPackaging(event.target.value)
                                }
                                placeholder="包装 (例: 袋、ボトル)"
                                value={packaging}
                            />
                            <Input
                                aria-label="商品URL"
                                className="h-7 text-xs"
                                onChange={(event) => setUrl(event.target.value)}
                                placeholder="https://..."
                                type="url"
                                value={url}
                            />
                        </div>
                    ) : null}
                </div>
            </TableCell>

            <TableCell className="min-w-36 space-y-1.5">
                <div className="flex flex-col gap-1.5">
                    <Button
                        disabled={isBusy}
                        onClick={() => void handleComplete()}
                        size="sm"
                        type="button"
                    >
                        {completeMutation.isPending
                            ? "登録中…"
                            : "登録して完了"}
                    </Button>
                    <Button
                        disabled={isBusy}
                        onClick={() => void handleCancel()}
                        size="sm"
                        type="button"
                        variant="outline"
                    >
                        キャンセル
                    </Button>
                </div>
                {rowError ? (
                    <p className="text-xs text-destructive" role="alert">
                        {rowError}
                    </p>
                ) : null}
            </TableCell>
        </TableRow>
    );
}
