import { describe, expect, it } from "vitest";
import {
    getOpenRouterUsage,
    type IntegrationServiceError,
} from "./integrationService";

describe("OpenRouter usage", () => {
    it("filters Activity API rows to the inventia workspace", async () => {
        const requests: string[] = [];
        const usage = await getOpenRouterUsage(
            { OPENROUTER_MANAGEMENT_KEY: "management-key" },
            async (input, init) => {
                requests.push(String(input));
                expect(init?.headers).toMatchObject({
                    authorization: "Bearer management-key",
                });
                if (String(input).includes("/workspaces")) {
                    return Response.json({
                        data: [
                            {
                                id: "550e8400-e29b-41d4-a716-446655440000",
                                name: "Inventia",
                                slug: "inventia",
                            },
                        ],
                    });
                }
                return Response.json({
                    data: [
                        {
                            model: "openai/gpt-5",
                            provider_name: "OpenAI",
                            requests: 2,
                            prompt_tokens: 100,
                            completion_tokens: 50,
                            reasoning_tokens: 20,
                            usage: 0.2,
                        },
                        {
                            model: "openai/gpt-5",
                            provider_name: "OpenAI",
                            requests: 1,
                            prompt_tokens: 40,
                            completion_tokens: 10,
                            reasoning_tokens: 5,
                            usage: 0.05,
                        },
                        {
                            model: "anthropic/claude-sonnet-4",
                            provider_name: "Anthropic",
                            requests: 1,
                            prompt_tokens: 20,
                            completion_tokens: 30,
                            usage: 0.1,
                        },
                    ],
                });
            },
        );

        expect(requests).toEqual([
            "https://openrouter.ai/api/v1/workspaces?limit=100",
            "https://openrouter.ai/api/v1/activity?group_by=workspace&workspace_id=550e8400-e29b-41d4-a716-446655440000",
        ]);
        expect(usage).toEqual({
            periodDays: 30,
            requestCount: 4,
            promptTokens: 160,
            completionTokens: 90,
            reasoningTokens: 25,
            totalTokens: 250,
            cost: 0.35,
            models: [
                {
                    model: "openai/gpt-5",
                    providerName: "OpenAI",
                    requestCount: 3,
                    promptTokens: 140,
                    completionTokens: 60,
                    reasoningTokens: 25,
                    totalTokens: 200,
                    cost: 0.25,
                },
                {
                    model: "anthropic/claude-sonnet-4",
                    providerName: "Anthropic",
                    requestCount: 1,
                    promptTokens: 20,
                    completionTokens: 30,
                    reasoningTokens: 0,
                    totalTokens: 50,
                    cost: 0.1,
                },
            ],
        });
    });

    it("reports when the inventia workspace is unavailable", async () => {
        await expect(
            getOpenRouterUsage(
                { OPENROUTER_MANAGEMENT_KEY: "management-key" },
                async () =>
                    Response.json({
                        data: [
                            {
                                id: "550e8400-e29b-41d4-a716-446655440000",
                                name: "Production",
                                slug: "production",
                            },
                        ],
                    }),
            ),
        ).rejects.toMatchObject({
            code: "INTEGRATION_WORKSPACE_UNAVAILABLE",
            status: 503,
        } satisfies Partial<IntegrationServiceError>);
    });

    it("does not call OpenRouter when the management secret is unavailable", async () => {
        await expect(getOpenRouterUsage({})).rejects.toMatchObject({
            code: "INTEGRATION_MANAGEMENT_KEY_UNAVAILABLE",
            status: 503,
        } satisfies Partial<IntegrationServiceError>);
    });
});
