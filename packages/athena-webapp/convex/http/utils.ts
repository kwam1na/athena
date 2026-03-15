import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { Id } from "../_generated/dataModel";
import { getActorClaims } from "./domains/storeFront/routes/actorAuth";

export const getStoreDataFromRequest = async (c: Context) => {
  const organizationId = getCookie(c, "organization_id") as Id<"organization">;
  const storeId = getCookie(c, "store_id") as Id<"store">;

  if (organizationId && storeId) {
    return { organizationId, storeId };
  }

  const claims = await getActorClaims(c);

  return {
    organizationId: (organizationId || claims?.organizationId) as
      | Id<"organization">
      | undefined,
    storeId: (storeId || claims?.storeId) as Id<"store"> | undefined,
  };
};

export const getStorefrontUserFromRequest = async (c: Context) => {
  const userId = getCookie(c, "user_id") as Id<"storeFrontUser">;
  const guestId = getCookie(c, "guest_id") as Id<"guest">;

  if (userId || guestId) {
    return userId || guestId;
  }

  const claims = await getActorClaims(c);

  return claims?.actorId as Id<"storeFrontUser"> | Id<"guest"> | undefined;
};
