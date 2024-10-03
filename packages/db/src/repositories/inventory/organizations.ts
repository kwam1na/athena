import {
  db,
  toSlug,
  type Organization,
  type OrganizationRequest,
} from "../../index";
import { eq } from "drizzle-orm";
import { organizations } from "../../models/schema";

export const organizationsRepository = {
  getAll: async () => await db.select().from(organizations),

  getById: async (id: number) => {
    const res = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id));

    return res[0];
  },

  getBySlug: async (slug: string) => {
    const res = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug));

    return res[0];
  },

  getOrganizationsForUser: async (userId: number): Promise<Organization[]> => {
    return await db
      .select()
      .from(organizations)
      .where(eq(organizations.createdByUserId, userId));
  },

  create: async (data: OrganizationRequest) => {
    const params = {
      ...data,
      slug: toSlug(data.name),
    };

    const res = await db.insert(organizations).values(params).returning();

    return res[0];
  },

  update: async (id: number, data: Partial<OrganizationRequest>) => {
    const params = {
      ...data,
      ...(data.name && { slug: toSlug(data.name) }),
      updatedAt: new Date(),
    };

    const res = await db
      .update(organizations)
      .set(params)
      .where(eq(organizations.id, id))
      .returning();

    return res[0];
  },

  delete: async (id: number) => {
    const res = await db
      .delete(organizations)
      .where(eq(organizations.id, id))
      .returning();

    return res[0];
  },
};
