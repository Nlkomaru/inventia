export const mcpSuccess = <T extends Record<string, unknown>>(value: T) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
});

export const mcpError = (message: string) => ({
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
});
