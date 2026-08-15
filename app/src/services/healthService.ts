import type { Health } from "../domain/health";

export const getHealth = (): Health => ({
    status: "ok",
    service: "inventia-api",
    deployedAt: import.meta.env.VITE_DEPLOYED_AT || null,
    checkedAt: new Date().toISOString(),
});
