import type {
	LocationCreateInput,
	LocationDto,
	LocationUpdateInput,
} from "@/domain/location";

type LocationListResponse = { items: LocationDto[]; nextCursor: string | null };
type ApiError = { error?: { message?: string } };

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
	const response = await fetch(url, init);
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as ApiError;
		throw new Error(body.error?.message ?? "保管場所の更新に失敗しました");
	}
	return (await response.json()) as T;
};

const listLevel = async (parentId: string | null): Promise<LocationDto[]> => {
	const result: LocationDto[] = [];
	let cursor: string | null = null;
	do {
		const params = new URLSearchParams({ limit: "100" });
		if (parentId) params.set("parentId", parentId);
		if (cursor) params.set("cursor", cursor);
		const page: LocationListResponse = await request(
			`/api/locations?${params.toString()}`,
		);
		result.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor);
	return result;
};

export const listLocationTree = async (): Promise<LocationDto[]> => {
	const result: LocationDto[] = [];
	const visit = async (parentId: string | null) => {
		const children = await listLevel(parentId);
		result.push(...children);
		for (const child of children) await visit(child.id);
	};
	await visit(null);
	return result;
};

export const createLocation = (input: LocationCreateInput) =>
	request<LocationDto>("/api/locations", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});

export const updateLocation = (id: string, input: LocationUpdateInput) =>
	request<LocationDto>(`/api/locations/${id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});

export const deleteLocation = (id: string) =>
	request<{ deleted: true }>(`/api/locations/${id}`, { method: "DELETE" });
