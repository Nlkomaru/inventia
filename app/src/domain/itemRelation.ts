import { z } from "zod";

export const itemRelationLabelSchema = z.string().trim().min(1).max(50);

export const itemRelationLinkSchema = z
    .object({
        parentItemId: z.string().trim().min(1),
        childItemId: z.string().trim().min(1),
        label: itemRelationLabelSchema.nullable().optional(),
    })
    .strict();

export const itemRelationUnlinkSchema = z
    .object({
        parentItemId: z.string().trim().min(1),
        childItemId: z.string().trim().min(1),
    })
    .strict();

export const itemRelationAddChildBodySchema = z
    .object({
        childItemId: z.string().trim().min(1),
        label: itemRelationLabelSchema.nullable().optional(),
    })
    .strict();

export const itemRelationDtoSchema = z.object({
    id: z.string().min(1),
    parentItemId: z.string().min(1),
    childItemId: z.string().min(1),
    label: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});

export const itemRelationUnlinkResultSchema = z.object({
    unlinked: z.literal(true),
});

export type ItemRelationLinkInput = z.infer<typeof itemRelationLinkSchema>;
export type ItemRelationUnlinkInput = z.infer<typeof itemRelationUnlinkSchema>;
export type ItemRelationAddChildBody = z.infer<
    typeof itemRelationAddChildBodySchema
>;
export type ItemRelationDto = z.infer<typeof itemRelationDtoSchema>;
export type ItemRelationUnlinkResult = z.infer<
    typeof itemRelationUnlinkResultSchema
>;
