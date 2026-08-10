import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
	itemCreateSchema,
	itemDtoSchema,
	itemListQuerySchema,
	itemUpdateSchema,
} from "../domain/item";
import {
	createItem,
	deleteItem,
	getItem,
	ItemServiceError,
	listItems,
	updateItem,
} from "../services/itemService";

type ItemBindings = { Bindings: { DB: D1Database } };

export const itemsApp = new OpenAPIHono<{ Bindings: { DB: D1Database } }>();

const itemErrorSchema = z.object({
	error: z.object({ code: z.string(), message: z.string() }),
});
const itemIdParameter = z
	.string()
	.min(1)
	.openapi({
		param: { name: "id", in: "path" },
		example: "019fecc7-da09-768f-b6e8-45904d46b277",
	});
const itemListSchema = z.object({
	items: z.array(itemDtoSchema),
	nextCursor: z.string().nullable(),
});
const deletedSchema = z.object({ deleted: z.literal(true) });
const responseContent = (schema: z.ZodType) => ({
	"application/json": { schema },
});
const errorResponses = {
	400: {
		description: "The request is invalid; correct the reported input.",
		content: responseContent(itemErrorSchema),
	},
	404: {
		description: "The requested item, category, or location does not exist.",
		content: responseContent(itemErrorSchema),
	},
	409: {
		description: "The operation conflicts with current inventory data.",
		content: responseContent(itemErrorSchema),
	},
	500: {
		description: "The service could not complete the request.",
		content: responseContent(itemErrorSchema),
	},
};

itemsApp.openAPIRegistry.registerPath({
	method: "get",
	path: "/",
	tags: ["Items"],
	summary: "Search inventory items",
	description:
		"Search item names and filter by category, location, or low-stock state with cursor pagination.",
	request: { query: itemListQuerySchema },
	responses: {
		200: {
			description: "A stable page of inventory items.",
			content: responseContent(itemListSchema),
		},
		...errorResponses,
	},
});
itemsApp.openAPIRegistry.registerPath({
	method: "get",
	path: "/{id}",
	tags: ["Items"],
	summary: "Get an inventory item",
	request: { params: z.object({ id: itemIdParameter }) },
	responses: {
		200: {
			description: "The requested inventory item.",
			content: responseContent(itemDtoSchema),
		},
		...errorResponses,
	},
});
itemsApp.openAPIRegistry.registerPath({
	method: "post",
	path: "/",
	tags: ["Items"],
	summary: "Create an inventory item",
	description:
		"Creates an item. A positive initial quantity also records an immutable stocktake movement.",
	request: {
		body: {
			required: true,
			content: responseContent(itemCreateSchema),
		},
	},
	responses: {
		201: {
			description: "The created inventory item.",
			content: responseContent(itemDtoSchema),
		},
		...errorResponses,
	},
});
itemsApp.openAPIRegistry.registerPath({
	method: "patch",
	path: "/{id}",
	tags: ["Items"],
	summary: "Update an inventory item",
	description:
		"Updates display metadata. Base unit and stock quantity are immutable through this endpoint.",
	request: {
		params: z.object({ id: itemIdParameter }),
		body: {
			required: true,
			content: responseContent(itemUpdateSchema),
		},
	},
	responses: {
		200: {
			description: "The updated inventory item.",
			content: responseContent(itemDtoSchema),
		},
		...errorResponses,
	},
});
itemsApp.openAPIRegistry.registerPath({
	method: "delete",
	path: "/{id}",
	tags: ["Items"],
	summary: "Delete an inventory item",
	request: { params: z.object({ id: itemIdParameter }) },
	responses: {
		200: {
			description: "The item was deleted.",
			content: responseContent(deletedSchema),
		},
		...errorResponses,
	},
});

type ItemsContext = Context<ItemBindings>;

type ErrorResponse = {
	error: {
		code: string;
		message: string;
	};
};

const errorResponse = (c: ItemsContext, error: unknown): Response => {
	if (error instanceof ItemServiceError) {
		return c.json(
			{
				error: {
					code: error.code,
					message: error.message,
				},
			} satisfies ErrorResponse,
			error.status,
		);
	}
	return c.json(
		{
			error: {
				code: "INTERNAL_ERROR",
				message: "an internal error occurred",
			},
		} satisfies ErrorResponse,
		500,
	);
};

const parseJson = async (c: ItemsContext): Promise<unknown> => {
	try {
		return await c.req.json();
	} catch {
		throw new ItemServiceError(
			400,
			"INVALID_JSON",
			"request body must be valid JSON",
		);
	}
};

itemsApp.get("/", async (c) => {
	try {
		return c.json(await listItems(c.env.DB, c.req.query()), 200);
	} catch (error) {
		return errorResponse(c, error);
	}
});

itemsApp.get("/:id", async (c) => {
	try {
		return c.json(await getItem(c.env.DB, c.req.param("id")), 200);
	} catch (error) {
		return errorResponse(c, error);
	}
});

itemsApp.post("/", async (c) => {
	try {
		return c.json(await createItem(c.env.DB, await parseJson(c)), 201);
	} catch (error) {
		return errorResponse(c, error);
	}
});

itemsApp.patch("/:id", async (c) => {
	try {
		return c.json(
			await updateItem(c.env.DB, c.req.param("id"), await parseJson(c)),
			200,
		);
	} catch (error) {
		return errorResponse(c, error);
	}
});

itemsApp.delete("/:id", async (c) => {
	try {
		await deleteItem(c.env.DB, c.req.param("id"));
		return c.json({ deleted: true }, 200);
	} catch (error) {
		return errorResponse(c, error);
	}
});

export default itemsApp;
