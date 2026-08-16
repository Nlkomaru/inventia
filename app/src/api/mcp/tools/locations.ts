import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    locationDtoSchema,
    locationIdSchema,
    locationListInputSchema,
    locationListOutputSchema,
} from "../../../domain/location";
import {
    getLocation,
    LocationServiceError,
    listLocations,
} from "../../../services/locationService";
import { mcpError, mcpSuccess } from "../result";

const locationIdInputSchema = z.object({ id: locationIdSchema }).strict();

const locationError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof LocationServiceError
            ? `${error.code}: ${error.message}`
            : `LOCATION_INTERNAL: ${fallback}`,
    );

export const registerLocationTools = (
    server: McpServer,
    db: D1Database,
): void => {
    server.registerTool(
        "list_locations",
        {
            title: "List storage locations",
            description:
                "List one level of the storage location tree. Use parentId null for root locations and nextCursor to continue pagination.",
            inputSchema: locationListInputSchema,
            outputSchema: locationListOutputSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await listLocations(db, input));
            } catch (error) {
                return locationError(error, "location listing failed");
            }
        },
    );

    server.registerTool(
        "get_location",
        {
            title: "Get storage location",
            description: "Get one storage location by its system ID.",
            inputSchema: locationIdInputSchema,
            outputSchema: locationDtoSchema,
        },
        async ({ id }) => {
            try {
                return mcpSuccess(await getLocation(db, id));
            } catch (error) {
                return locationError(error, "location lookup failed");
            }
        },
    );
};
