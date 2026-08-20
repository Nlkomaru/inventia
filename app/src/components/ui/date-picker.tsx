import { ja } from "date-fns/locale";
import { CalendarIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// 日付の受け渡しは常に YYYY-MM-DD の文字列にする。Date を跨がせると
// タイムゾーンの解釈が呼び出し側ごとにぶれるため、変換は端でだけ行う
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const pad = (value: number): string => String(value).padStart(2, "0");

/** カレンダーの選択結果を YYYY-MM-DD へ写す。表示している月日をそのまま使う。 */
const toDateValue = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * YYYY-MM-DD をカレンダーの選択日へ戻す。存在しない日付は選択なしとして扱う
 * （Date が 2 月 30 日を 3 月へ繰り上げるため、往復させて確かめる）。
 */
const toDate = (value: string): Date | undefined => {
    if (!datePattern.test(value)) return undefined;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return toDateValue(date) === value ? date : undefined;
};

export type DatePickerProps = {
    id: string;
    /** ラベル要素が無い場所（表の行など）で入力欄の名前を与える。 */
    "aria-label"?: string;
    /** YYYY-MM-DD。空文字は未入力を表す。 */
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    /** カレンダーを開くボタンの読み上げ名。同じ画面に複数置くときに区別する。 */
    calendarLabel?: string;
    /**
     * 入力済みの日付を空へ戻すボタンをカレンダーの横に置く。日付の有無自体が
     * 意味を持つ欄（空欄なら期限なし、など）で、消す操作を明示するために使う。
     */
    clearable?: boolean;
    /** 日付を消すボタンの読み上げ名。同じ画面に複数置くときに区別する。 */
    clearLabel?: string;
};

/**
 * 日付の入力。YYYY-MM-DD をそのまま打てるテキスト欄と、カレンダーからの
 * 選択を組み合わせる。ブラウザ既定の日付欄と違い、表示の書式が環境で変わらない。
 */
export function DatePicker({
    id,
    value,
    onValueChange,
    disabled = false,
    className,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    "aria-label": label,
    calendarLabel = "カレンダーから日付を選ぶ",
    clearable = false,
    clearLabel = "日付を空にする",
}: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const selected = toDate(value);

    return (
        <div className={cn("flex items-center gap-2", className)}>
            <Input
                aria-describedby={describedBy}
                aria-invalid={invalid}
                aria-label={label}
                autoComplete="off"
                disabled={disabled}
                id={id}
                inputMode="numeric"
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="2020-01-01"
                value={value}
            />
            <Popover onOpenChange={setOpen} open={open}>
                <PopoverTrigger
                    render={
                        <Button
                            aria-label={calendarLabel}
                            disabled={disabled}
                            size="icon"
                            type="button"
                            variant="outline"
                        >
                            <CalendarIcon />
                        </Button>
                    }
                />
                <PopoverContent align="end" className="w-auto p-0">
                    <Calendar
                        autoFocus
                        defaultMonth={selected}
                        locale={ja}
                        mode="single"
                        onSelect={(date) => {
                            if (!date) return;
                            onValueChange(toDateValue(date));
                            setOpen(false);
                        }}
                        selected={selected}
                    />
                </PopoverContent>
            </Popover>
            {clearable ? (
                // 空欄でも位置を保つため、隠さず disabled にする
                <Button
                    aria-label={clearLabel}
                    disabled={disabled || value === ""}
                    onClick={() => onValueChange("")}
                    size="icon"
                    type="button"
                    variant="outline"
                >
                    <XIcon />
                </Button>
            ) : null}
        </div>
    );
}
