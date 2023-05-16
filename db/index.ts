// import { getSessionUser } from "./auth";
// import { getUserProfile } from "./profiles";
// import { getStore } from "./stores";

// export const db = {
//   profiles: {
//     get: async (id: string) => getUserProfile(id),
//   },
//   stores: {
//     get: async (id: string) => getStore(id),
//   },
//   auth: {
//     getSessionUser: async () => getSessionUser(),
//   },
// };
import * as profiles from "./profiles";
import * as stores from "./stores";
import * as auth from "./auth";
import * as items from "./items";
import * as categories from "./categories";
import * as subcategories from "./subcategories";
import * as transactions from "./transactions";

export const db = {
  profiles,
  stores,
  auth,
  items,
  categories,
  subcategories,
  transactions,
};
