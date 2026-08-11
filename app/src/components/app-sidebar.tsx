"use client";

import { useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, WarehouseIcon } from "lucide-react";
import type * as React from "react";
import { SearchForm } from "@/components/search-form";
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

const data = {
	navMain: [
		{
			title: "在庫管理",
			items: [
				{ title: "在庫一覧", url: "/" },
				{ title: "入庫", url: "/inventory/receive" },
				{ title: "出庫", url: "/inventory/issue" },
				{ title: "棚卸・調整", url: "/inventory/stocktake" },
				{ title: "在庫履歴", url: "/inventory/history" },
				{ title: "レシート取込", url: "/receipts/new" },
			],
		},
		{
			title: "マスタ",
			items: [
				{ title: "品目", url: "/items" },
				{ title: "カテゴリ", url: "/categories" },
				{ title: "保管場所", url: "/locations" },
				{ title: "識別子・外部リンク", url: "/references" },
			],
		},
		{
			title: "連携・設定",
			items: [
				{ title: "API リファレンス", url: "/api/scalar" },
				{ title: "MCP エンドポイント", url: "/api/mcp" },
			],
		},
	],
	resources: [
		{ title: "Licence", url: "/license" },
		{
			title: "GitHub",
			url: "https://github.com/Nlkomaru/inventia",
		},
		{
			title: "Storybook",
			url: "https://storybook.inventia.nikomaru.dev",
		},
	],
};

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
							// biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
							render={<a aria-label="Inventia ホーム" href="/" />}
						>
							<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
								<WarehouseIcon className="size-4" />
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">Inventia</span>
								<span className="truncate text-xs">Nagano City Home</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<SearchForm />
			</SidebarHeader>
			<SidebarContent>
				{data.navMain.map((group) => (
					<SidebarGroup key={group.title}>
						<SidebarGroupLabel>{group.title}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{group.items.map((item) => (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton
											isActive={pathname === item.url}
											// biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
											render={<a aria-label={item.title} href={item.url} />}
										>
											{item.title}
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
					{data.resources.map((item) => {
						const isExternal = item.url.startsWith("https://");

						return (
							<SidebarMenuItem key={item.title}>
								<SidebarMenuButton
									isActive={pathname === item.url}
									render={
										// biome-ignore lint/a11y/useAnchorContent: Base UI forwards SidebarMenuButton children to this anchor.
										<a
											aria-label={item.title}
											href={item.url}
											rel={isExternal ? "noreferrer" : undefined}
											target={isExternal ? "_blank" : undefined}
										/>
									}
								>
									{item.title}
									{isExternal ? <ExternalLinkIcon /> : null}
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
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
