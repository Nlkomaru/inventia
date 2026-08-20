import { Globe } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 連携先のファビコン。画像は保管せず外部サイトの URL をそのまま読み込むため、
 * 読み込めなかった URL を覚えて代替アイコンへ倒す。装飾なので alt は空にする。
 */
export function ProviderFavicon({
    className,
    faviconUrl,
}: {
    className?: string;
    faviconUrl: string | null;
}) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    // URL を変えたときは前回の失敗を引きずらないよう、値そのもので判定する
    const src = faviconUrl === failedUrl ? null : faviconUrl;
    if (src === null) {
        return (
            <Globe
                aria-hidden="true"
                className={cn(
                    "size-4 shrink-0 text-muted-foreground",
                    className,
                )}
            />
        );
    }
    return (
        <img
            alt=""
            className={cn("size-4 shrink-0 object-contain", className)}
            onError={() => setFailedUrl(src)}
            // 外部サイトへ閲覧元を渡さない
            referrerPolicy="no-referrer"
            src={src}
        />
    );
}
