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

export const getStorefrontActorFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser"> | undefined;
  if (userId) {
    return { kind: "storefrontUser" as const, id: userId };
  }

  const guestId = getCookie(c, "guest_id") as Id<"guest"> | undefined;
  if (guestId) {
    return { kind: "guest" as const, id: guestId };
  }

  return undefined;
};
