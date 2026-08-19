import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { StocktakeRowInput } from "../-functions/stocktake-rows";

type StocktakeRowProps = {
    row: StocktakeRowInput;
    // 行番号は入力欄のラベルに使う（期限が未入力の行も区別できるようにする）
    position: number;
    currentQuantity: number | null;
    baseUnit: string;
    expiryError: string | null;
    quantityError: string | null;
    disabled: boolean;
    onChange: (patch: Partial<StocktakeRowInput>) => void;
    onRemove: () => void;
    formatExpiry: (value: string | null) => string;
};

export function StocktakeRow({
    row,
    position,
    currentQuantity,
    baseUnit,
    expiryError,
    quantityError,
    disabled,
    onChange,
    onRemove,
    formatExpiry,
}: StocktakeRowProps) {
    // 既存ロットの期限は表示だけにする（期限の変更はロット操作で行う）
    const isExistingLot = row.expiryInput === null;
    return (
        <TableRow>
            <TableCell className="align-top">
                {isExistingLot ? (
                    formatExpiry(row.expiryDate)
                ) : (
                    <DatePicker
                        aria-invalid={Boolean(expiryError)}
                        aria-label={`${position}行目の期限`}
                        calendarLabel={`${position}行目の期限をカレンダーから選ぶ`}
                        disabled={disabled}
                        id={`stocktake-expiry-${position}`}
                        onValueChange={(value) =>
                            onChange({ expiryInput: value })
                        }
                        value={row.expiryInput ?? ""}
                    />
                )}
                {expiryError ? <FieldError>{expiryError}</FieldError> : null}
            </TableCell>
            <TableCell className="text-right align-top">
                {currentQuantity === null
                    ? "—"
                    : `${currentQuantity} ${baseUnit}`}
            </TableCell>
            <TableCell className="align-top">
                <Input
                    aria-invalid={Boolean(quantityError)}
                    aria-label={`${position}行目の実在庫`}
                    disabled={disabled}
                    inputMode="numeric"
                    min={0}
                    onChange={(event) =>
                        onChange({ quantity: event.target.value })
                    }
                    step={1}
                    type="number"
                    value={row.quantity}
                />
                {quantityError ? (
                    <FieldError>{quantityError}</FieldError>
                ) : null}
            </TableCell>
            <TableCell className="text-right align-top">
                <Button
                    aria-label={`${position}行目を一覧から外す`}
                    disabled={disabled}
                    onClick={onRemove}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                >
                    <Trash2 data-icon="inline-start" />
                </Button>
            </TableCell>
        </TableRow>
    );
}
