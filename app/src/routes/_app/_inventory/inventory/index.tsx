import { createFileRoute, redirect } from "@tanstack/react-router";

// 在庫一覧は /inventory/items へ移した。以前の URL を開いたブックマークや
// 外部リンクを行き止まりにしないため、ここは移動先へ送るだけにする
export const Route = createFileRoute("/_app/_inventory/inventory/")({
    beforeLoad: () => {
        throw redirect({ to: "/inventory/items" });
    },
});
