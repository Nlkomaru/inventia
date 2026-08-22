import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    locationCreateInputSchema,
    locationDtoSchema,
    locationIdSchema,
    locationListInputSchema,
    locationListOutputSchema,
    locationTreeOutputSchema,
} from "../../../domain/location";
import {
    createLocation,
    getLocation,
    LocationServiceError,
    listLocations,
    listLocationTree,
    locationTreeMaxSize,
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
        "list_location_tree",
        {
            title: "List the whole storage location tree",
            description: `Return every storage location in one call, ordered by sortOrder then by id, so a caller does not have to walk the tree one level at a time with list_locations. Each item carries its parentId, which is enough to rebuild the hierarchy and to match a name anywhere in the tree — names are only unique among siblings, so a full path needs the ancestors. At most ${locationTreeMaxSize} locations are returned and truncated is true when there are more; there is no cursor for the rest, so fall back to list_locations per level in that case. This tool only reads data.`,
            inputSchema: z.object({}).strict(),
            outputSchema: locationTreeOutputSchema,
        },
        async () => {
            try {
                return mcpSuccess(await listLocationTree(db));
            } catch (error) {
                return locationError(error, "location tree listing failed");
            }
        },
    );

    server.registerTool(
        "get_location",
        {
            title: "Get storage location",
            description:
                "Get one storage location by its system ID. To resolve several locations, or to build a location's full path from its ancestors, read the whole tree once with list_location_tree instead of calling this per id.",
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

    server.registerTool(
        "create_location",
        {
            title: "Create storage location",
            description:
                "Create one storage location and return it with its generated system ID. name is required. parentId places the location inside an existing location and null, which is the default, creates a root location; a parentId that does not exist is rejected with LOCATION_PARENT_NOT_FOUND, so create the parent first. Names only have to be unique among the siblings of the same parent, including among the root locations, and a duplicate is rejected with LOCATION_NAME_CONFLICT; the same name can therefore be created again under a different parent, which is why a full path needs the ancestors. sortOrder defaults to 0 and orders the location among its siblings, ties being broken by id. Only one location row is created; no item, stock, lot or price data changes. Verify the result with list_locations for the same parentId, or with list_location_tree.",
            inputSchema: locationCreateInputSchema,
            outputSchema: locationDtoSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await createLocation(db, input));
            } catch (error) {
                return locationError(error, "location creation failed");
            }
        },
    );
};
