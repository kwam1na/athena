import { z } from "zod";

export const userSchema = z.object({
  organizationId: z.string(),
  activeStoreId: z.string(),
  userName: z.string(),
});

export type UserType = z.infer<typeof userSchema>;

export type UserResponse = UserType & { id: string };
