import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    externalProviderCreateInputSchema,
    externalProviderDeleteOutputSchema,
    externalProviderDtoSchema,
    externalProviderIdSchema,
    externalProviderListSchema,
    externalProviderUpdateInputSchema,
} from "../../../domain/externalProvider";
import {
    createExternalProvider,
    deleteExternalProvider,
    ExternalProviderServiceError,
    listExternalProviders,
    updateExternalProvider,
} from "../../../services/externalProviderService";
import { mcpError, mcpSuccess } from "../result";

const externalProviderIdInputSchema = z
    .object({ id: externalProviderIdSchema })
    .strict();

// 更新対象の id は入力に足すだけで、更新できるフィールドはドメインの定義に従う。
// id があるため「1 つ以上のフィールドが必要」という制約はここでは成立せず、
// service の再検証が EXTERNAL_PROVIDER_INVALID_INPUT として返す
const externalProviderUpdateToolSchema =
    externalProviderUpdateInputSchema.extend({ id: externalProviderIdSchema });

const externalProviderError = (error: unknown, fallback: string) =>
    mcpError(
        error instanceof ExternalProviderServiceError
            ? `${error.code}: ${error.message}`
            : `EXTERNAL_PROVIDER_INTERNAL: ${fallback}`,
    );

export const registerExternalProviderTools = (
    server: McpServer,
    db: D1Database,
): void => {
    server.registerTool(
        "list_external_providers",
        {
            title: "List external providers",
            description:
                "Return the external providers in one call, ordered by name then by id, up to the first 200. An external provider is an outside application that inventory usage can be attributed to, so resolve a provider id here before recording stock usage that names one. Providers are a small master list, so there is no cursor and no filter; read the list once and match the name in the caller. faviconUrl and url are plain http or https URLs kept for display only and are never fetched by this API. This tool only reads data.",
            inputSchema: z.object({}).strict(),
            outputSchema: externalProviderListSchema,
        },
        async () => {
            try {
                return mcpSuccess(await listExternalProviders(db));
            } catch (error) {
                return externalProviderError(
                    error,
                    "external provider listing failed",
                );
            }
        },
    );

    server.registerTool(
        "create_external_provider",
        {
            title: "Create external provider",
            description:
                "Creates one external provider that stock usage can be attributed to. Side effects: one external provider row is created; no item, stock or price data changes. name is required and unique across all providers, so a name that already exists is rejected instead of creating a second one — list the providers first and reuse the existing id. faviconUrl and url are optional display URLs that must use http or https, and default to null.",
            inputSchema: externalProviderCreateInputSchema,
            outputSchema: externalProviderDtoSchema,
        },
        async (input) => {
            try {
                return mcpSuccess(await createExternalProvider(db, input));
            } catch (error) {
                return externalProviderError(
                    error,
                    "external provider creation failed",
                );
            }
        },
    );

    server.registerTool(
        "update_external_provider",
        {
            title: "Update external provider",
            description:
                "Renames the external provider named by id or changes its faviconUrl or url; the fields you send replace the stored values and the fields you omit stay unchanged. At least one of name, faviconUrl, or url is required, faviconUrl and url must use http or https, and sending either as null clears it. Stock movements that already reference this provider keep pointing at it and their stored external ids are not touched.",
            inputSchema: externalProviderUpdateToolSchema,
            outputSchema: externalProviderDtoSchema,
        },
        async ({ id, ...fields }) => {
            try {
                return mcpSuccess(await updateExternalProvider(db, id, fields));
            } catch (error) {
                return externalProviderError(
                    error,
                    "external provider update failed",
                );
            }
        },
    );

    server.registerTool(
        "delete_external_provider",
        {
            title: "Delete external provider",
            description:
                "Deletes the external provider named by id when no stock movement refers to it. Side effects: the provider row is removed; no stock movement is deleted or rewritten. A provider that stock movements still refer to is rejected so their history keeps pointing at a provider that exists; change the provider recorded on those movements first.",
            inputSchema: externalProviderIdInputSchema,
            outputSchema: externalProviderDeleteOutputSchema,
        },
        async ({ id }) => {
            try {
                await deleteExternalProvider(db, id);
                return mcpSuccess({ deleted: true as const });
            } catch (error) {
                return externalProviderError(
                    error,
                    "external provider deletion failed",
                );
            }
        },
    );
};
