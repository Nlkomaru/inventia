import { queryOptions } from "@tanstack/react-query";
import { openRouterUsageQueryOptions } from "../../integrations/-api/integration-queries";
import { getMcpUsage } from "./usage-api";

export const usageKeys = {
    all: ["usage"] as const,
    mcp: () => [...usageKeys.all, "mcp"] as const,
};

export const mcpUsageQueryOptions = () =>
    queryOptions({
        queryKey: usageKeys.mcp(),
        queryFn: () => getMcpUsage(),
        retry: false,
    });

export { openRouterUsageQueryOptions };
