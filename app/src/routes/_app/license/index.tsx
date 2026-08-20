import { createFileRoute } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import licenseGroups from "./-data.json";

export const Route = createFileRoute("/_app/license/")({
    staticData: {
        breadcrumbs: [
            { label: "Inventia", to: "/inventory/items" },
            { label: "ライセンス" },
        ],
    },
    component: LicensePage,
});

function LicensePage() {
    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
            <header>
                <h1 className="mt-1 text-2xl font-bold">
                    オープンソースソフトウェアライセンス一覧
                </h1>
            </header>

            {licenseGroups.map((group) => (
                <section className="flex flex-col gap-4" key={group.license}>
                    <div className="flex flex-col gap-1">
                        <h2 className="font-bold">{group.license}</h2>
                        <p className="text-xs text-muted-foreground">
                            {group.packages.length} パッケージ
                        </p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {group.packages.map((packageInfo) => (
                            <PackageLicenseCard
                                key={`${packageInfo.name}-${packageInfo.versions.join("-")}`}
                                packageInfo={packageInfo}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </main>
    );
}

type PackageInfo = (typeof licenseGroups)[number]["packages"][number];

function PackageLicenseCard({ packageInfo }: { packageInfo: PackageInfo }) {
    const card = (
        <Card className="h-full" size="sm">
            <CardHeader>
                <CardTitle className="break-all">{packageInfo.name}</CardTitle>
                <CardDescription>
                    {packageInfo.versions
                        .map((version) => `v${version}`)
                        .join(", ")}
                </CardDescription>
                {packageInfo.homepage ? (
                    <CardAction>
                        <ExternalLinkIcon
                            aria-hidden="true"
                            className="size-4"
                        />
                    </CardAction>
                ) : null}
            </CardHeader>
            <CardContent>
                <p className="text-muted-foreground">
                    Author: {packageInfo.author ?? "Unknown"}
                </p>
            </CardContent>
        </Card>
    );

    if (packageInfo.homepage) {
        return (
            <a
                className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                href={packageInfo.homepage}
                rel="noreferrer"
                target="_blank"
            >
                {card}
            </a>
        );
    }

    return card;
}
