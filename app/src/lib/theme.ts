export const themes = ["light", "dark", "system"] as const;

export type Theme = (typeof themes)[number];
export type ResolvedTheme = Exclude<Theme, "system">;

export const themeStorageKey = "inventia-theme";

const darkMediaQuery = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
    return themes.includes(value as Theme);
}

function readStoredTheme(): Theme {
    try {
        const stored = localStorage.getItem(themeStorageKey);

        return isTheme(stored) ? stored : "system";
    } catch {
        // Safari のプライベートモードなど localStorage が読めない環境
        return "system";
    }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
    if (theme !== "system") {
        return theme;
    }

    return window.matchMedia(darkMediaQuery).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
    const resolved = resolveTheme(theme);
    const root = document.documentElement;

    root.classList.toggle("dark", resolved === "dark");
    // ネイティブ UI（スクロールバー、フォーム部品）も追従させる
    root.style.colorScheme = resolved;
}

let currentTheme: Theme | null = null;
const listeners = new Set<() => void>();

/** useSyncExternalStore の getSnapshot。同じ値を返し続ける必要がある */
export function getTheme(): Theme {
    currentTheme ??= readStoredTheme();

    return currentTheme;
}

/** サーバーには保存値も matchMedia も無いため、既定の system を返す */
export function getServerTheme(): Theme {
    return "system";
}

export function setTheme(theme: Theme) {
    currentTheme = theme;

    try {
        localStorage.setItem(themeStorageKey, theme);
    } catch {
        // 保存できなくても現在のタブには反映する
    }

    applyTheme(theme);

    for (const listener of listeners) {
        listener();
    }
}

export function subscribeTheme(onStoreChange: () => void) {
    listeners.add(onStoreChange);

    // system のときは OS 側の切り替えに追従する
    const media = window.matchMedia(darkMediaQuery);
    const handleMediaChange = () => {
        if (getTheme() !== "system") {
            return;
        }

        applyTheme("system");
        onStoreChange();
    };

    // 別タブでの変更も同じ表示に揃える
    const handleStorage = (event: StorageEvent) => {
        if (event.key !== themeStorageKey) {
            return;
        }

        currentTheme = isTheme(event.newValue) ? event.newValue : "system";
        applyTheme(currentTheme);
        onStoreChange();
    };

    media.addEventListener("change", handleMediaChange);
    window.addEventListener("storage", handleStorage);

    return () => {
        listeners.delete(onStoreChange);
        media.removeEventListener("change", handleMediaChange);
        window.removeEventListener("storage", handleStorage);
    };
}

/**
 * ハイドレーション前に <html> へテーマを当て、初回描画のちらつきを防ぐ。
 * バンドルより先に走るため、この文字列だけで完結させる。
 */
export const themeInitScript = `(function () {
	try {
		var stored = localStorage.getItem(${JSON.stringify(themeStorageKey)});
		var resolved =
			stored === "light" || stored === "dark"
				? stored
				: window.matchMedia(${JSON.stringify(darkMediaQuery)}).matches
					? "dark"
					: "light";
		document.documentElement.classList.toggle("dark", resolved === "dark");
		document.documentElement.style.colorScheme = resolved;
	} catch (error) {}
})();`;
