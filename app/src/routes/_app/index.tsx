import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			{Array.from({ length: 24 }).map((_, index) => (
				<div
					key={index}
					className="aspect-video h-12 w-full rounded-lg bg-muted/50"
				/>
			))}
		</div>
	);
}
