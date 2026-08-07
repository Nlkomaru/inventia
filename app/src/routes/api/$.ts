import { createFileRoute } from "@tanstack/react-router";
import { apiApp } from "../../api/app";

const forwardToHono = ({ request }: { request: Request }) =>
	apiApp.fetch(request);

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: forwardToHono,
			POST: forwardToHono,
			PUT: forwardToHono,
			PATCH: forwardToHono,
			DELETE: forwardToHono,
			OPTIONS: forwardToHono,
			HEAD: forwardToHono,
		},
	},
});
