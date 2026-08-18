import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/_master/references/")({
    staticData: {
        breadcrumbs: [{ label: "識別子・外部リンク" }],
    },
    component: ReferencesPage,
});

function ReferencesPage() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">識別子・外部リンク</h1>
            </header>
            <p className="text-sm text-muted-foreground">
                登録機能は未実装です。
            </p>
        </main>
    );
}
