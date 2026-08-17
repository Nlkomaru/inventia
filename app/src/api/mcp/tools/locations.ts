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
                "List one level of the storage location tree, ordered by sortOrder then by id. parentId selects the level and null lists the root locations. q filters that level by name with a case-insensitive partial match, where % and _ in q are matched literally rather than as wildcards, and the filter never reaches into other levels. Results return at most limit locations (default 50, maximum 100), and pass nextCursor back as cursor to continue; a cursor is only valid for the parentId and q it was made with, and reusing it with a different parentId or q is rejected as an invalid cursor.",
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
