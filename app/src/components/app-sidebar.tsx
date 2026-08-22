"use client";

import { useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, WarehouseIcon } from "lucide-react";
import type * as React from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";
import { navigationGroups, navigationResources } from "@/lib/navigation";

const deployedAt =
    import.meta.env.VITE_DEPLOYED_AT ?? "2026-08-11T04:59:26.000Z";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });

    return (
        <Sidebar {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            render={
                                // biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
                                <a
                                    aria-label="Inventia ホーム"
                                    href="/inventory/items"
                                />
                            }
                        >
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <WarehouseIcon className="size-4" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">
                                    Inventia
                                </span>
                                <span className="truncate text-xs">
                                    Nagano City Home
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                {navigationGroups.map((group) => (
                    <SidebarGroup key={group.title}>
                        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {group.items.map((item) => (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            isActive={pathname === item.url}
                                            render={
                                                // biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
                                                <a
                                                    aria-label={
                                                        item.opensInNewTab
                                                            ? `${item.title}（新しいタブで開く）`
                                                            : item.title
                                                    }
                                                    href={item.url}
                                                    rel={
                                                        item.opensInNewTab
                                                            ? "noreferrer"
                                                            : undefined
                                                    }
                                                    target={
                                                        item.opensInNewTab
                                                            ? "_blank"
                                                            : undefined
                                                    }
                                                />
                                            }
                                        >
                                            {item.title}
                                            {item.opensInNewTab ? (
                                                <ExternalLinkIcon />
                                            ) : null}
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ))}
            </SidebarContent>
            <SidebarFooter className="mt-auto">
                <SidebarMenu>
                    {navigationResources.map((item) => {
                        // 別オリジンは常に別タブ。同一オリジンでも opensInNewTab で明示できる
                        const isExternal =
                            item.opensInNewTab ??
                            item.url.startsWith("https://");

                        return (
                            <SidebarMenuItem key={item.title}>
                                <SidebarMenuButton
                                    isActive={pathname === item.url}
                                    render={
                                        // biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
                                        <a
                                            aria-label={item.title}
                                            href={item.url}
                                            rel={
                                                isExternal
                                                    ? "noreferrer"
                                                    : undefined
                                            }
                                            target={
                                                isExternal
                                                    ? "_blank"
                                                    : undefined
                                            }
                                        />
                                    }
                                >
                                    {item.title}
                                    {isExternal ? <ExternalLinkIcon /> : null}
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        );
                    })}
                    <ThemeToggle />
                </SidebarMenu>
                <div className="px-2 pt-4 text-xs leading-5 text-sidebar-foreground/70">
                    <p>Deployed: {deployedAt.split(".")[0]}</p>
                    <p>No right reserved.</p>
                </div>
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
