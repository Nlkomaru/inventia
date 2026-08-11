import { z } from "zod";

export const itemBaseDimensionSchema = z.enum(["mass", "volume", "count"]);

export const itemDtoSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	categoryId: z.string(),
	locationId: z.string(),
	baseUnit: z.string(),
	baseDimension: itemBaseDimensionSchema,
	currentQuantity: z.int().min(0),
	expiryDate: z.string().datetime().nullable(),
	lowStockThreshold: z.int().min(0).nullable(),
	memo: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const isoDateTimeSchema = z.iso.datetime({ offset: true });

const itemFields = {
	name: z.string().trim().min(1).max(200),
	categoryId: z.string().trim().min(1),
	locationId: z.string().trim().min(1),
	baseUnit: z.string().trim().min(1).max(50),
	baseDimension: itemBaseDimensionSchema,
	currentQuantity: z.int().min(0),
	expiryDate: isoDateTimeSchema.nullable(),
	lowStockThreshold: z.int().min(0).nullable(),
	memo: z.string().max(2000).nullable(),
};

export const itemCreateSchema = z
	.object({
		name: itemFields.name,
		categoryId: itemFields.categoryId,
		locationId: itemFields.locationId,
		baseUnit: itemFields.baseUnit.optional(),
		baseDimension: itemFields.baseDimension.optional(),
		currentQuantity: itemFields.currentQuantity.optional(),
		expiryDate: itemFields.expiryDate.optional(),
		lowStockThreshold: itemFields.lowStockThreshold.optional(),
		memo: itemFields.memo.optional(),
	})
	.strict()
	.refine(
		(value) =>
			(value.baseUnit === undefined) === (value.baseDimension === undefined),
		{
			message: "baseUnit and baseDimension must be provided together",
			path: ["baseDimension"],
		},
	);

export const itemUpdateSchema = z
	.object({
		name: itemFields.name.optional(),
		categoryId: itemFields.categoryId.optional(),
		locationId: itemFields.locationId.optional(),
		// Base unit and current quantity are immutable through item CRUD.
		// Stock changes must go through the stock-adjustment service.
		baseUnit: itemFields.baseUnit.optional(),
		baseDimension: itemFields.baseDimension.optional(),
		expiryDate: itemFields.expiryDate.optional(),
		lowStockThreshold: itemFields.lowStockThreshold.optional(),
		memo: itemFields.memo.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, {
		message: "at least one field is required",
	});

export const itemListQuerySchema = z.object({
	q: z.string().trim().max(200).optional(),
	categoryId: z.string().trim().min(1).optional(),
	locationId: z.string().trim().min(1).optional(),
	lowStockOnly: z
		.preprocess(
			(value) =>
				value === "true" || value === "1"
					? true
					: value === "false" || value === "0"
						? false
						: value,
			z.boolean(),
		)
		.optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().min(1).optional(),
});

export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

export type ItemDto = z.infer<typeof itemDtoSchema>;
