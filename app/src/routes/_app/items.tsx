import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "./-page-placeholder";

export const Route = createFileRoute("/_app/items")({ component: ItemsPage });

function ItemsPage() {
	return <PagePlaceholder title="品目" description="品目情報を管理します。" />;
}
