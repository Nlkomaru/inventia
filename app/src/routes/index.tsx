import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../components/Button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const [pressCount, setPressCount] = useState(0);
	return (
		<div className="p-8">
			<h1 className="text-4xl font-bold">Welcome to TanStack Start</h1>
			<p className="mt-4 text-lg">
				Edit <code>src/routes/index.tsx</code> to get started.
			</p>
			<div className="mt-6 flex items-center gap-4">
				<Button onPress={() => setPressCount((count) => count + 1)}>
					Try React Aria
				</Button>
				<p aria-live="polite" className="text-sm text-slate-600">
					{pressCount === 0
						? "Ready for keyboard and pointer input."
						: `Pressed ${pressCount} ${pressCount === 1 ? "time" : "times"}.`}
				</p>
			</div>
		</div>
	);
}
