import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import type { ApiBindings } from "./bindings";
import { categoriesApp } from "./http/categories";
import { healthApp } from "./http/health";
import { integrationsApp } from "./http/integrations";
import { itemsApp } from "./http/items";
import { locationsApp } from "./http/locations";
import { lotsApp } from "./http/lots";
import { pricesApp } from "./http/prices";
import { stockInventoryApp, stockItemsApp } from "./http/stock";
import { handleMcpRequest } from "./mcp/handler";

export const apiApp = new OpenAPIHono<ApiBindings>();

apiApp.route("/api/health", healthApp);
apiApp.route("/api/categories", categoriesApp);
apiApp.route("/api/locations", locationsApp);
apiApp.route("/api/items", itemsApp);
apiApp.route("/api/items", pricesApp);
apiApp.route("/api/items", stockItemsApp);
apiApp.route("/api/items", lotsApp);
apiApp.route("/api/inventory", stockInventoryApp);
apiApp.route("/api/settings/integrations", integrationsApp);

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
