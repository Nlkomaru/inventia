import {
    infiniteQueryOptions,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import type {
    PriceResearchCompleteInput,
    PriceResearchCreateInput,
    PriceResearchStatus,
} from "@/domain/priceResearch";
import {
    cancelPriceResearchRequestFn,
    completePriceResearchRequestFn,
    createPriceResearchRequestFn,
    listPriceResearchRequests,
} from "./price-research-api";

export const priceResearchKeys = {
    all: ["price-research"] as const,
    list: (status: PriceResearchStatus) =>
        [...priceResearchKeys.all, "list", status] as const,
};

export const priceResearchPageSize = 50;

export const priceResearchListQueryOptions = (status: PriceResearchStatus) =>
    infiniteQueryOptions({
        queryKey: priceResearchKeys.list(status),
        queryFn: ({ pageParam }) =>
            listPriceResearchRequests({
                data: {
                    status,
                    limit: priceResearchPageSize,
                    ...(pageParam === null ? {} : { cursor: pageParam }),
                },
            }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
    });

export const useCreatePriceResearchMutation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: PriceResearchCreateInput) =>
            createPriceResearchRequestFn({ data: input }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: priceResearchKeys.all,
            });
        },
    });
};

export const useCompletePriceResearchMutation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: {
            id: string;
            input: PriceResearchCompleteInput;
        }) => completePriceResearchRequestFn({ data: params }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: priceResearchKeys.all,
                }),
                queryClient.invalidateQueries({
                    queryKey: ["prices"],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["items"],
                }),
            ]);
        },
    });
};

export const useCancelPriceResearchMutation = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => cancelPriceResearchRequestFn({ data: id }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: priceResearchKeys.all,
            });
        },
    });
};
