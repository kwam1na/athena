import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { Id } from "../_generated/dataModel";

export const getStoreDataFromRequest = (c: Context) => {
  const organizationId = getCookie(c, "organization_id") as Id<"organization">;
  const storeId = getCookie(c, "store_id") as Id<"store">;

  return { organizationId, storeId };
};

export const getStorefrontUserFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser">;
  const guestId = getCookie(c, "guest_id") as Id<"guest">;

  return userId || guestId;
};
