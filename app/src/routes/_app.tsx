import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import { Fragment } from "react";
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
import { breadcrumbsFromLoaderData } from "@/lib/breadcrumbs";

export const Route = createFileRoute("/_app")({ component: AppLayout });

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
    // 階層は一致した route の並びがそのまま表す。各 route は自分の段だけを
    // 名乗り、loader が段を返した場合はそちらを使う（品目名や場所の祖先など）
    const breadcrumbs = useMatches({
        select: (matches) =>
            matches.flatMap(
                (match) =>
                    breadcrumbsFromLoaderData(match.loaderData) ??
                    match.staticData.breadcrumbs ??
                    [],
            ),
    });

    return (
        <Breadcrumb>
            <BreadcrumbList>
                {breadcrumbs.map((breadcrumb, index) => {
                    const isCurrent = index === breadcrumbs.length - 1;

                    return (
                        <Fragment
                            key={`${breadcrumb.label}-${breadcrumb.to ?? "current"}`}
                        >
                            {index > 0 ? <BreadcrumbSeparator /> : null}
                            <BreadcrumbItem>
                                {isCurrent || !breadcrumb.to ? (
                                    <BreadcrumbPage>
                                        {breadcrumb.label}
                                    </BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink
                                        render={
                                            // biome-ignore lint/a11y/useAnchorContent: Base UI forwards BreadcrumbLink children to this anchor.
                                            <a
                                                aria-label={breadcrumb.label}
                                                href={breadcrumb.to}
                                            />
                                        }
                                    >
                                        {breadcrumb.label}
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                        </Fragment>
                    );
                })}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
