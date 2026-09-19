import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import type { ItemDetailDto } from "@/domain/item";
import type { PriceRecordDto } from "@/domain/price";
import { ItemPriceForm } from "./item-price-form";

/**
 * 価格履歴をその場で訂正する。記録日時は表示だけにして、フォームの更新入力へ渡さない。
 */
export function ItemPriceEditDialog({
    item,
    record,
}: {
    item: ItemDetailDto;
    record: PriceRecordDto;
}) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog onOpenChange={setOpen} open={open}>
            <DialogTrigger render={<Button size="sm" variant="outline" />}>
                編集
            </DialogTrigger>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>価格を訂正</DialogTitle>
                    <DialogDescription>
                        内容量、セット数、価格、取得元などを修正できます。記録日時は変更されません。
                    </DialogDescription>
                </DialogHeader>
                {open ? (
                    <ItemPriceForm
                        item={item}
                        onSaved={() => setOpen(false)}
                        record={record}
                        actions={(submitButton) => (
                            <DialogFooter>
                                <DialogClose
                                    render={
                                        <Button
                                            type="button"
                                            variant="outline"
                                        />
                                    }
                                >
                                    キャンセル
                                </DialogClose>
                                {submitButton}
                            </DialogFooter>
                        )}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
