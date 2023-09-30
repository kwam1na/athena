import { getSessionUser } from "./auth";
import { getUserProfile } from "./profiles";
import { getStore } from "./stores";

export const db = {
  profiles: {
    get: async (id: string) => getUserProfile(id),
  },
  stores: {
    get: async (id: string) => getStore(id),
  },
  auth: {
    getSessionUser: async () => getSessionUser(),
  },
};
