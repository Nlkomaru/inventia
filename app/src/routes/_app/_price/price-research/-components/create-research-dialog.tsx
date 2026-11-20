import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ItemDto } from "@/domain/item";
import { useCreatePriceResearchMutation } from "../-api/price-research-queries";

interface CreateResearchDialogProps {
    items: ItemDto[];
}

const UNREGISTERED_VALUE = "__unregistered__";

export function CreateResearchDialog({ items }: CreateResearchDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedItemId, setSelectedItemId] =
        useState<string>(UNREGISTERED_VALUE);
    const [requestedItemName, setRequestedItemName] = useState("");
    const [requestedUnit, setRequestedUnit] = useState("");
    const [purpose, setPurpose] = useState("");
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);

    const createMutation = useCreatePriceResearchMutation();

    const selectedItem =
        selectedItemId !== UNREGISTERED_VALUE
            ? items.find((item) => item.id === selectedItemId)
            : undefined;

    const handleItemChange = (value: string | null) => {
        const next = value ?? UNREGISTERED_VALUE;
        setSelectedItemId(next);
        if (next !== UNREGISTERED_VALUE) {
            const item = items.find((entry) => entry.id === next);
            if (item) {
                setRequestedItemName(item.name);
                setRequestedUnit(item.baseUnit);
            }
        }
    };

    const resetForm = () => {
        setSelectedItemId(UNREGISTERED_VALUE);
        setRequestedItemName("");
        setRequestedUnit("");
        setPurpose("");
        setNote("");
        setError(null);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        const trimmedName = requestedItemName.trim();
        if (selectedItemId === UNREGISTERED_VALUE && trimmedName.length === 0) {
            setError("品目名を入力してください");
            return;
        }

        try {
            await createMutation.mutateAsync({
                ...(selectedItemId !== UNREGISTERED_VALUE
                    ? { itemId: selectedItemId }
                    : {}),
                ...(trimmedName.length > 0
                    ? { requestedItemName: trimmedName }
                    : {}),
                ...(requestedUnit.trim().length > 0
                    ? { requestedUnit: requestedUnit.trim() }
                    : {}),
                ...(purpose.trim().length > 0
                    ? { purpose: purpose.trim() }
                    : {}),
                ...(note.trim().length > 0 ? { note: note.trim() } : {}),
                requestedBy: "manual",
            });
            resetForm();
            setOpen(false);
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "調査依頼の作成に失敗しました",
            );
        }
    };

    return (
        <Dialog
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) {
                    resetForm();
                }
            }}
            open={open}
        >
            <DialogTrigger
                render={
                    <Button size="sm" type="button">
                        <PlusIcon className="mr-1.5 size-4" />
                        調査依頼を追加
                    </Button>
                }
            />
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>価格調査依頼を作成</DialogTitle>
                    <DialogDescription>
                        店頭やネットで確認したい品目の価格調査依頼を追加します。
                    </DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={handleSubmit}>
                    {error ? (
                        <p
                            className="rounded-md bg-destructive/10 p-2.5 text-sm text-destructive"
                            role="alert"
                        >
                            {error}
                        </p>
                    ) : null}

                    <div className="space-y-1.5">
                        <Label htmlFor="research-item-select">
                            登録済み品目（任意）
                        </Label>
                        <Select
                            onValueChange={handleItemChange}
                            value={selectedItemId}
                        >
                            <SelectTrigger
                                className="w-full"
                                id="research-item-select"
                            >
                                <SelectValue>
                                    {selectedItem
                                        ? `${selectedItem.name} (${selectedItem.baseUnit})`
                                        : "未登録の品目として依頼"}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={UNREGISTERED_VALUE}>
                                    未登録の品目として依頼
                                </SelectItem>
                                {items.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                        {item.name} ({item.baseUnit})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label htmlFor="research-item-name">
                                品目名{" "}
                                {selectedItemId === UNREGISTERED_VALUE ? (
                                    <span className="text-destructive">*</span>
                                ) : null}
                            </Label>
                            <Input
                                id="research-item-name"
                                onChange={(event) =>
                                    setRequestedItemName(event.target.value)
                                }
                                placeholder="例: 強力粉、オリーブオイル"
                                value={requestedItemName}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="research-unit">目安単位</Label>
                            <Input
                                id="research-unit"
                                onChange={(event) =>
                                    setRequestedUnit(event.target.value)
                                }
                                placeholder="例: g, mL, 個"
                                value={requestedUnit}
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="research-purpose">用途・目的</Label>
                        <Input
                            id="research-purpose"
                            onChange={(event) => setPurpose(event.target.value)}
                            placeholder="例: レシピ原価の比較のため"
                            value={purpose}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="research-note">メモ</Label>
                        <Textarea
                            id="research-note"
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="確認したい容量や店舗の条件など"
                            rows={3}
                            value={note}
                        />
                    </div>

                    <DialogFooter>
                        <Button
                            onClick={() => setOpen(false)}
                            type="button"
                            variant="outline"
                        >
                            閉じる
                        </Button>
                        <Button
                            disabled={createMutation.isPending}
                            type="submit"
                        >
                            {createMutation.isPending
                                ? "作成中…"
                                : "依頼を作成"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
