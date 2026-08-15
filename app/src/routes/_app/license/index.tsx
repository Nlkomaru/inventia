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
            { label: "Inventia", to: "/inventory" },
            { label: "ライセンス" },
        ],
    },
    component: LicensePage,
});

function LicensePage() {
    return (
        <main className="flex flex-1 flex-col gap-8 p-4 md:p-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold">
                    オープンソースソフトウェアライセンス一覧
                </h1>
                <p className="text-muted-foreground">
                    Inventia が利用する本番依存パッケージのライセンス情報です。
                </p>
            </div>

            {licenseGroups.map((group) => (
                <section className="flex flex-col gap-4" key={group.license}>
                    <div className="flex flex-col gap-1">
                        <h2 className="text-xl font-semibold">
                            {group.license}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            {getLicenseDescription(group.license)}（
                            {group.packages.length} パッケージ）
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

const licenseDescriptions: Readonly<Record<string, string>> = {
    MIT: "著作権表示を条件に、改変・再配布・商用利用を許可するライセンス",
    "Apache-2.0": "特許権の明示的な許諾を含むライセンス",
    "BSD-2-Clause": "2 条項からなる簡潔なパーミッシブライセンス",
    "BSD-3-Clause": "開発者名の宣伝利用を制限するパーミッシブライセンス",
    ISC: "MIT と同様の条件を簡潔に記したライセンス",
    "MPL-2.0": "変更したファイル単位でソース公開を求めるライセンス",
    "OFL-1.1": "フォントの利用・改変・再配布を認めるライセンス",
    Unlicense: "著作物をパブリックドメイン相当として扱うライセンス",
};

function getLicenseDescription(license: string) {
    return (
        licenseDescriptions[license] ??
        "利用条件は各パッケージのライセンスを参照してください"
    );
}
