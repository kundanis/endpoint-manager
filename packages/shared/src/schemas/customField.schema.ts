import { z } from "zod";

export const createCustomFieldRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    fieldType: z.enum(["TEXT", "NUMBER", "DATE", "SELECT"]),
    options: z.array(z.string().max(100)).max(50).optional(),
  })
  .refine((data) => data.fieldType !== "SELECT" || (data.options && data.options.length > 0), {
    message: "options is required and must be non-empty when fieldType is SELECT",
    path: ["options"],
  });
export type CreateCustomFieldRequest = z.infer<typeof createCustomFieldRequestSchema>;

export const updateCustomFieldRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  options: z.array(z.string().max(100)).max(50).optional(),
});
export type UpdateCustomFieldRequest = z.infer<typeof updateCustomFieldRequestSchema>;

export const setCustomFieldValuesRequestSchema = z.object({
  values: z.array(
    z.object({
      fieldDefinitionId: z.string().min(1),
      value: z.string().max(1000),
    }),
  ),
});
export type SetCustomFieldValuesRequest = z.infer<typeof setCustomFieldValuesRequestSchema>;
