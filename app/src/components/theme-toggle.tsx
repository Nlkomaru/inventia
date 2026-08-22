"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
    getServerTheme,
    getTheme,
    isTheme,
    setTheme,
    subscribeTheme,
    type Theme,
} from "@/lib/theme";

const themeOptions = [
    { value: "light", label: "ライト", icon: SunIcon },
    { value: "dark", label: "ダーク", icon: MoonIcon },
    { value: "system", label: "システム", icon: MonitorIcon },
] as const satisfies readonly {
    value: Theme;
    label: string;
    icon: typeof SunIcon;
}[];

export function ThemeToggle() {
    const theme = useSyncExternalStore(
        subscribeTheme,
        getTheme,
        getServerTheme,
    );
    // サーバーと初回ハイドレーションでは system 相当を描画する
    const active =
        themeOptions.find((option) => option.value === theme) ??
        themeOptions[2];
    const ActiveIcon = active.icon;

    return (
        <SidebarMenuItem>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <SidebarMenuButton
                            aria-label={`テーマ: ${active.label}`}
                        >
                            <ActiveIcon />
                            テーマ: {active.label}
                        </SidebarMenuButton>
                    }
                />
                <DropdownMenuContent align="start" side="top">
                    <DropdownMenuRadioGroup
                        onValueChange={(value) => {
                            if (isTheme(value)) {
                                setTheme(value);
                            }
                        }}
                        value={theme}
                    >
                        {themeOptions.map((option) => {
                            const OptionIcon = option.icon;

                            return (
                                <DropdownMenuRadioItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    <OptionIcon />
                                    {option.label}
                                </DropdownMenuRadioItem>
                            );
                        })}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </SidebarMenuItem>
    );
}
