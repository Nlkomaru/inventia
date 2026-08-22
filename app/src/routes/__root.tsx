import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
    createRootRouteWithContext,
    HeadContent,
    Outlet,
    Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { themeInitScript } from "@/lib/theme";
import appCss from "../styles.css?url";

export type RouterContext = {
    queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
    head: () => ({
        meta: [
            {
                charSet: "utf-8",
            },
            {
                name: "viewport",
                content: "width=device-width, initial-scale=1",
            },
            {
                title: "Inventia - AI native inventory management system",
            },
        ],
        links: [
            {
                rel: "stylesheet",
                href: appCss,
            },
        ],
    }),
    component: RootLayout,
    shellComponent: RootDocument,
});

function RootLayout() {
    return <Outlet />;
}

function RootDocument({ children }: { children: React.ReactNode }) {
    return (
        // テーマ適用スクリプトが hydration より先に class を書き換える
        <html lang="ja" suppressHydrationWarning>
            <head>
                <HeadContent />
                <script
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: バンドル読み込み前にテーマを当て、初回描画のちらつきを防ぐ
                    dangerouslySetInnerHTML={{ __html: themeInitScript }}
                />
            </head>
            <body>
                {children}
                <TanStackDevtools
                    config={{
                        position: "bottom-right",
                    }}
                    plugins={[
                        {
                            name: "Tanstack Router",
                            render: <TanStackRouterDevtoolsPanel />,
                        },
                        {
                            name: "Tanstack Query",
                            render: <ReactQueryDevtoolsPanel />,
                        },
                    ]}
                />
                <Scripts />
            </body>
        </html>
    );
}
