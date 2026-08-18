import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
    // Workers の isolate は複数リクエストを跨ぐため、QueryClient はリクエストごとに生成する。
    // モジュールスコープへ置くと利用者間でキャッシュが混ざる。
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                // staleTime が 0 だと loader で ensureQueryData した値をマウント直後に再取得する。
                staleTime: 30_000,
            },
        },
    });

    const router = createTanStackRouter({
        routeTree,
        context: { queryClient },
        scrollRestoration: true,
        defaultPreload: "intent",
        // 鮮度は TanStack Query の staleTime が判断するため、router 側は preload のたびに
        // loader を実行し、実際の再取得可否を ensureQueryData へ委ねる。
        defaultPreloadStaleTime: 0,
    });

    // dehydrate / hydrate の接続と QueryClientProvider の注入 (router.options.Wrap) を行う。
    setupRouterSsrQueryIntegration({ router, queryClient });

    return router;
}

declare module "@tanstack/react-router" {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }

    interface StaticDataRouteOption {
        breadcrumbs?: ReadonlyArray<{
            label: string;
            to?: string;
        }>;
    }
}
