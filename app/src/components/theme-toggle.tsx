"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
    getServerTheme,
    getTheme,
    subscribeTheme,
    toggleTheme,
} from "@/lib/theme";

export function ThemeToggle() {
    const theme = useSyncExternalStore(
        subscribeTheme,
        getTheme,
        getServerTheme,
    );
    const isDark = theme === "dark";
    // 現在のテーマではなく、押したときに切り替わる先を示す
    const label = isDark ? "ライトテーマに切り替え" : "ダークテーマに切り替え";

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton
                    aria-label={label}
                    onClick={toggleTheme}
                    type="button"
                >
                    {isDark ? <SunIcon /> : <MoonIcon />}
                    {label}
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
