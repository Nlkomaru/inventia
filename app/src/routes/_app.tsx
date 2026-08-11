import {
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/_app")({ component: AppLayout });

const pageTitleByPath: Record<string, string> = {
	"/": "在庫一覧",
	"/categories": "カテゴリ",
	"/inventory/history": "在庫履歴",
	"/inventory/issue": "出庫",
	"/inventory/receive": "入庫",
	"/inventory/stocktake": "棚卸・調整",
	"/items": "品目",
	"/license": "Licence",
	"/locations": "保管場所",
	"/receipts/new": "レシート取込",
	"/references": "識別子・外部リンク",
};

function AppLayout() {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="sticky top-0 flex h-16 shrink-0 items-center border-b bg-background px-4">
					<SidebarTrigger />
					<Separator
						orientation="vertical"
						className="py-[2px] mr-4 ml-2 h-8 my-auto"
					/>
					<AppBreadcrumb />
				</header>
				<Outlet />
			</SidebarInset>
		</SidebarProvider>
	);
}

function AppBreadcrumb() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const pageTitle = pageTitleByPath[pathname] ?? "Inventia";

	return (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink
						render={
							// biome-ignore lint/a11y/useAnchorContent: Base UI forwards BreadcrumbLink children to this anchor.
							<a aria-label="Inventia ホーム" href="/" />
						}
					>
						Inventia
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbSeparator />
				<BreadcrumbItem>
					<BreadcrumbPage>{pageTitle}</BreadcrumbPage>
				</BreadcrumbItem>
			</BreadcrumbList>
		</Breadcrumb>
	);
}
