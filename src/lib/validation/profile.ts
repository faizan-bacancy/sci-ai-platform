import { z } from "zod";

export const updateProfileNameSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
});

export type UpdateProfileNameInput = z.infer<typeof updateProfileNameSchema>;

