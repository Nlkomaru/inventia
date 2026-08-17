import { queryOptions } from "@tanstack/react-query";
import { listLocationTree } from "./location-api";

export const locationKeys = {
    all: ["locations"] as const,
    tree: () => [...locationKeys.all, "tree"] as const,
};

export const locationTreeQueryOptions = () =>
    queryOptions({
        queryKey: locationKeys.tree(),
        queryFn: () => listLocationTree(),
    });
