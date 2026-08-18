import { Camera, FileImage, Upload, X } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import {
    type Accept,
    ErrorCode,
    type FileRejection,
    useDropzone,
} from "react-dropzone";
import { Button } from "@/components/ui/button";
import {
    receiptAllowedContentTypes,
    receiptMaxByteSize,
} from "@/domain/receipt";
import { cn } from "@/lib/utils";
import { megabytes, validateFile } from "../-functions/receipt-file";

// 受け付ける形式は domain の許可リストから組み立てる。拡張子は指定せず MIME だけで絞る
const dropzoneAccept: Accept = Object.fromEntries(
    receiptAllowedContentTypes.map((type): [string, string[]] => [type, []]),
);
const cameraAccept = receiptAllowedContentTypes.join(",");

const statusId = "receipt-dropzone-status";
const errorId = "receipt-dropzone-error";

/** react-dropzone の拒否理由を validateFile と同じ日本語へ寄せる。 */
const rejectionMessage = (rejection: FileRejection): string => {
    if (
        rejection.errors.some((error) => error.code === ErrorCode.TooManyFiles)
    ) {
        return "レシート画像は 1 枚ずつ取り込めます";
    }
    return validateFile(rejection.file) ?? "この画像は取り込めません";
};

type ReceiptDropzoneProps = {
    file: File | null;
    error: string | null;
    /** アップロード中・解析中の進行状況。null のときは読み上げ領域を空にする。 */
    statusMessage: string | null;
    disabled: boolean;
    onSelect: (file: File) => void;
    onReject: (message: string) => void;
    onClear: () => void;
};

export function ReceiptDropzone({
    file,
    error,
    statusMessage,
    disabled,
    onSelect,
    onReject,
    onClear,
}: ReceiptDropzoneProps) {
    const { getRootProps, getInputProps, isDragAccept, isDragReject } =
        useDropzone({
            accept: dropzoneAccept,
            disabled,
            maxSize: receiptMaxByteSize,
            multiple: false,
            onDrop: (accepted: File[], rejections: FileRejection[]) => {
                const rejected = rejections[0];
                if (rejected !== undefined) {
                    onReject(rejectionMessage(rejected));
                    return;
                }
                const selected = accepted[0];
                if (selected === undefined) return;
                const invalid = validateFile(selected);
                if (invalid !== null) {
                    onReject(invalid);
                    return;
                }
                onSelect(selected);
            },
        });

    const cameraInputRef = useRef<HTMLInputElement>(null);
    // 同じ写真を撮り直したときも change が発火するよう value を戻す
    const handleCapture = (event: ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0];
        event.target.value = "";
        if (selected === undefined) return;
        const invalid = validateFile(selected);
        if (invalid !== null) {
            onReject(invalid);
            return;
        }
        onSelect(selected);
    };

    const describedBy = [statusId, error === null ? null : errorId]
        .filter((id): id is string => id !== null)
        .join(" ");

    return (
        <div className="flex flex-col gap-3">
            <div
                {...getRootProps({
                    "aria-describedby": describedBy,
                    "aria-label":
                        "レシート画像を選ぶ。ここへドラッグ＆ドロップするか、Enter キーでファイルを選択します",
                    className: cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-card px-4 py-8 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                        disabled
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer hover:bg-accent/50",
                        isDragAccept && "border-primary bg-accent",
                        isDragReject && "border-destructive bg-destructive/10",
                        error !== null && "border-destructive",
                    ),
                    role: "button",
                })}
            >
                {/* capture はここへ付けない。モバイルでカメラ固定になり、撮影済み画像を選べなくなる */}
                <input
                    {...getInputProps({
                        "aria-label": "レシート画像ファイル",
                    })}
                />
                <Upload
                    aria-hidden="true"
                    className={cn(
                        "size-6",
                        isDragAccept ? "text-primary" : "text-muted-foreground",
                    )}
                />
                <p className="text-sm font-medium">
                    {isDragAccept
                        ? "ここに画像を落としてください"
                        : "レシート画像をドラッグ＆ドロップ、またはクリックして選択"}
                </p>
                <p className="text-xs text-muted-foreground">
                    JPEG・PNG・WebP を {megabytes(receiptMaxByteSize)} まで、1
                    枚ずつ
                </p>
            </div>

            {/* ドロップゾーンの外に置き、ルート div のクリック（通常のファイル選択）と競合させない */}
            <div className="flex items-center gap-3">
                <input
                    accept={cameraAccept}
                    aria-label="レシートを撮影"
                    capture="environment"
                    hidden
                    onChange={handleCapture}
                    ref={cameraInputRef}
                    tabIndex={-1}
                    type="file"
                />
                <Button
                    disabled={disabled}
                    onClick={() => cameraInputRef.current?.click()}
                    size="sm"
                    type="button"
                    variant="outline"
                >
                    <Camera aria-hidden="true" />
                    カメラで撮影
                </Button>
            </div>

            {file === null ? null : (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <FileImage
                        aria-hidden="true"
                        className="size-5 shrink-0 text-muted-foreground"
                    />
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                            {file.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {megabytes(file.size)}
                        </span>
                    </div>
                    <Button
                        aria-label={`${file.name} の選択を取り消す`}
                        className="ml-auto"
                        disabled={disabled}
                        onClick={onClear}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                    >
                        <X />
                    </Button>
                </div>
            )}

            <p
                aria-live="polite"
                className={cn(
                    "text-sm text-muted-foreground",
                    statusMessage === null && "sr-only",
                )}
                id={statusId}
            >
                {statusMessage ?? ""}
            </p>

            {error === null ? null : (
                <p
                    className="text-sm text-destructive"
                    id={errorId}
                    role="alert"
                >
                    {error}
                </p>
            )}
        </div>
    );
}
