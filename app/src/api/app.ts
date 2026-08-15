import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { ApiBindings } from "./bindings";
import { healthApp } from "./http/health";
import { itemsApp } from "./http/items";
import { locationsApp } from "./http/locations";
import { handleMcpRequest } from "./mcp/handler";

export const apiApp = new OpenAPIHono<ApiBindings>();

apiApp.route("/api/health", healthApp);
apiApp.route("/api/locations", locationsApp);
apiApp.route("/api/items", itemsApp);

apiApp.doc31("/api/openapi", {
    openapi: "3.1.0",
    info: {
        title: "Inventia API",
        version: "1.0.0",
        description: "HTTP API and health surface for Inventia.",
    },
});

apiApp.get(
    "/api/scalar",
    Scalar({
        url: "/api/openapi",
    }),
);

apiApp.all("/api/mcp", handleMcpRequest);

export default apiApp;
