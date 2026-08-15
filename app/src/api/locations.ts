import { OpenAPIHono, z } from "@hono/zod-openapi";
import {
    locationCreateInputSchema,
    locationDtoSchema,
    locationListInputSchema,
    locationUpdateInputSchema,
} from "../domain/location";
import {
    createLocation,
    getLocation,
    LocationServiceError,
    listLocations,
    removeLocation,
    updateLocation,
} from "../services/locationService";

type LocationBindings = {
    Bindings: { DB: D1Database };
};

type LocationsContext = Parameters<Parameters<typeof locationsApp.get>[1]>[0];

export const locationsApp = new OpenAPIHono<LocationBindings>();

const locationErrorSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
const locationIdParameter = z
    .string()
    .min(1)
    .openapi({
        param: { name: "id", in: "path" },
        example: "019fecc7-b5ed-71d4-9ed3-fc56612cb7ae",
    });
const locationListSchema = z.object({
    items: z.array(locationDtoSchema),
    nextCursor: z.string().nullable(),
});
const deletedSchema = z.object({ deleted: z.literal(true) });
const responseContent = (schema: z.ZodType) => ({
    "application/json": { schema },
});
const errorResponses = {
    400: {
        description: "The request is invalid; correct the reported input.",
        content: responseContent(locationErrorSchema),
    },
    404: {
        description: "The requested location does not exist.",
        content: responseContent(locationErrorSchema),
    },
    409: {
        description:
            "The location conflicts with its siblings, children, or items.",
        content: responseContent(locationErrorSchema),
    },
    422: {
        description:
            "The parent relationship is missing or would create a cycle.",
        content: responseContent(locationErrorSchema),
    },
    500: {
        description: "The service could not complete the request.",
        content: responseContent(locationErrorSchema),
    },
};

locationsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/",
    tags: ["Locations"],
    summary: "List storage locations",
    description:
        "Lists one level of the storage tree with stable cursor pagination.",
    request: { query: locationListInputSchema },
    responses: {
        200: {
            description: "A stable page of storage locations.",
            content: responseContent(locationListSchema),
        },
        ...errorResponses,
    },
});
locationsApp.openAPIRegistry.registerPath({
    method: "get",
    path: "/{id}",
    tags: ["Locations"],
    summary: "Get a storage location",
    request: { params: z.object({ id: locationIdParameter }) },
    responses: {
        200: {
            description: "The requested storage location.",
            content: responseContent(locationDtoSchema),
        },
        ...errorResponses,
    },
});
locationsApp.openAPIRegistry.registerPath({
    method: "post",
    path: "/",
    tags: ["Locations"],
    summary: "Create a storage location",
    request: {
        body: {
            required: true,
            content: responseContent(locationCreateInputSchema),
        },
    },
    responses: {
        201: {
            description: "The created storage location.",
            content: responseContent(locationDtoSchema),
        },
        ...errorResponses,
    },
});
locationsApp.openAPIRegistry.registerPath({
    method: "patch",
    path: "/{id}",
    tags: ["Locations"],
    summary: "Update a storage location",
    description:
        "Renames, reorders, or moves a location without allowing tree cycles.",
    request: {
        params: z.object({ id: locationIdParameter }),
        body: {
            required: true,
            content: responseContent(locationUpdateInputSchema),
        },
    },
    responses: {
        200: {
            description: "The updated storage location.",
            content: responseContent(locationDtoSchema),
        },
        ...errorResponses,
    },
});
locationsApp.openAPIRegistry.registerPath({
    method: "delete",
    path: "/{id}",
    tags: ["Locations"],
    summary: "Delete a storage location",
    description:
        "Deletes an empty location that has no children and no referencing items.",
    request: { params: z.object({ id: locationIdParameter }) },
    responses: {
        200: {
            description: "The location was deleted.",
            content: responseContent(deletedSchema),
        },
        ...errorResponses,
    },
});

const errorResponse = (c: LocationsContext, error: unknown): Response => {
    if (error instanceof LocationServiceError) {
        return c.json(
            {
                error: {
                    code: error.code,
                    message: error.message,
                },
            },
            error.status as 400 | 404 | 409 | 422 | 500,
        );
    }
    return c.json(
        {
            error: {
                code: "INTERNAL_ERROR",
                message: "内部エラーが発生しました",
            },
        },
        500,
    );
};

const parseJson = async (c: LocationsContext): Promise<unknown> => {
    try {
        return await c.req.json();
    } catch {
        throw new LocationServiceError(
            "LOCATION_INVALID_INPUT",
            "リクエスト本文は有効なJSONで指定してください",
        );
    }
};

locationsApp.get("/", async (c) => {
    try {
        return c.json(await listLocations(c.env.DB, c.req.query()), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

locationsApp.get("/:id", async (c) => {
    try {
        return c.json(await getLocation(c.env.DB, c.req.param("id")), 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

locationsApp.post("/", async (c) => {
    try {
        return c.json(await createLocation(c.env.DB, await parseJson(c)), 201);
    } catch (error) {
        return errorResponse(c, error);
    }
});

locationsApp.patch("/:id", async (c) => {
    try {
        return c.json(
            await updateLocation(
                c.env.DB,
                c.req.param("id"),
                await parseJson(c),
            ),
            200,
        );
    } catch (error) {
        return errorResponse(c, error);
    }
});

locationsApp.delete("/:id", async (c) => {
    try {
        await removeLocation(c.env.DB, c.req.param("id"));
        return c.json({ deleted: true }, 200);
    } catch (error) {
        return errorResponse(c, error);
    }
});

export default locationsApp;
