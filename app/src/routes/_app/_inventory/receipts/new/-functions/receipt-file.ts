import {
    receiptAllowedContentTypes,
    receiptMaxByteSize,
} from "@/domain/receipt";

// アップロード前のファイル検証。dropzone の拒否理由も同じ文言へ落とすため、
// 画面側で個別のメッセージを持たずここだけを参照する。

export const isAllowedContentType = (value: string): boolean =>
    receiptAllowedContentTypes.some((allowed) => allowed === value);

export const megabytes = (bytes: number): string =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const validateFile = (file: File | null): string | null => {
    if (file === null) return "レシート画像を選択してください";
    if (file.size === 0) return "空のファイルは取り込めません";
    if (!isAllowedContentType(file.type)) {
        return "JPEG・PNG・WebP の画像を選んでください";
    }
    if (file.size > receiptMaxByteSize) {
        return `画像は ${megabytes(receiptMaxByteSize)} 以下にしてください`;
    }
    return null;
};
