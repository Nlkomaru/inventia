import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    locationCreateInputSchema,
    locationDeleteOutputSchema,
    locationDtoSchema,
    locationIdSchema,
    locationListInputSchema,
    locationListOutputSchema,
    locationUpdateInputSchema,
} from "../../../domain/location";
import {
    createLocation,
    getLocation,
    LocationServiceError,
    listLocations,
    removeLocation,
    updateLocation,
} from "../../../services/locationService";
import { mcpError, mcpSuccess } from "../result";

const locationIdInputSchema = z.object({ id: locationIdSchema }).strict();
const locationUpdateToolInputSchema = z
    .object({
        id: locationIdSchema,
        changes: locationUpdateInputSchema,
    })
    .strict();

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

    server.registerTool(
        "create_location",
        {
            title: "Create storage location",
            description:
                "Create a storage location, optionally below an existing parent location.",
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

    server.registerTool(
        "update_location",
        {
            title: "Update storage location",
            description:
                "Rename, reorder, or move a storage location. Supply the fields to change in changes.",
            inputSchema: locationUpdateToolInputSchema,
            outputSchema: locationDtoSchema,
        },
        async ({ id, changes }) => {
            try {
                return mcpSuccess(await updateLocation(db, id, changes));
            } catch (error) {
                return locationError(error, "location update failed");
            }
        },
    );

    server.registerTool(
        "delete_location",
        {
            title: "Delete storage location",
            description:
                "Delete an empty storage location that has no child locations and is not referenced by inventory items.",
            inputSchema: locationIdInputSchema,
            outputSchema: locationDeleteOutputSchema,
        },
        async ({ id }) => {
            try {
                await removeLocation(db, id);
                return mcpSuccess({ deleted: true as const });
            } catch (error) {
                return locationError(error, "location deletion failed");
            }
        },
    );
};
