export const themes = ["light", "dark"] as const;

export type Theme = (typeof themes)[number];

export const themeStorageKey = "inventia-theme";

const darkMediaQuery = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
    return themes.includes(value as Theme);
}

/** 明示的に選ばれたテーマ。未選択なら null */
function readStoredTheme(): Theme | null {
    try {
        const stored = localStorage.getItem(themeStorageKey);

        return isTheme(stored) ? stored : null;
    } catch {
        // Safari のプライベートモードなど localStorage が読めない環境
        return null;
    }
}

function preferredTheme(): Theme {
    return window.matchMedia(darkMediaQuery).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
    const root = document.documentElement;

    root.classList.toggle("dark", theme === "dark");
    // ネイティブ UI（スクロールバー、フォーム部品）も追従させる
    root.style.colorScheme = theme;
}

let currentTheme: Theme | null = null;
const listeners = new Set<() => void>();

/** useSyncExternalStore の getSnapshot。同じ値を返し続ける必要がある */
export function getTheme(): Theme {
    currentTheme ??= readStoredTheme() ?? preferredTheme();

    return currentTheme;
}

/** サーバーには保存値も matchMedia も無いため、既定の light を返す */
export function getServerTheme(): Theme {
    return "light";
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

export function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
}

export function subscribeTheme(onStoreChange: () => void) {
    listeners.add(onStoreChange);

    // 未選択のうちは OS 側の切り替えに追従する
    const media = window.matchMedia(darkMediaQuery);
    const handleMediaChange = () => {
        if (readStoredTheme() !== null) {
            return;
        }

        currentTheme = preferredTheme();
        applyTheme(currentTheme);
        onStoreChange();
    };

    // 別タブでの変更も同じ表示に揃える
    const handleStorage = (event: StorageEvent) => {
        if (event.key !== themeStorageKey) {
            return;
        }

        currentTheme = isTheme(event.newValue)
            ? event.newValue
            : preferredTheme();
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
		var theme =
			stored === "light" || stored === "dark"
				? stored
				: window.matchMedia(${JSON.stringify(darkMediaQuery)}).matches
					? "dark"
					: "light";
		document.documentElement.classList.toggle("dark", theme === "dark");
		document.documentElement.style.colorScheme = theme;
	} catch (error) {}
})();`;
