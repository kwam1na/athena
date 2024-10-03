import { db } from "../../index";
import { eq } from "drizzle-orm";
import { guests } from "../../models/store-front/guests";

export const guestsRepository = {
  getAll: async () => {
    return await db.select().from(guests);
  },

  getById: async (id: number) => {
    const res = await db.select().from(guests).where(eq(guests.id, id));
    return res[0];
  },

  create: async () => {
    const res = await db.insert(guests).values({}).returning();
    return res[0];
  },

  delete: async (id: number) => {
    const res = await db.delete(guests).where(eq(guests.id, id)).returning();

    return res[0];
  },
};
