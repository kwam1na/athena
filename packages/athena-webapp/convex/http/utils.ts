import { Context } from "hono";
import { getCookie } from "hono/cookie";

export const getStoreDataFromRequest = (c: Context) => {
  const organizationId = getCookie(c, "organization_id");
  const storeId = getCookie(c, "store_id");

  return { organizationId, storeId };
};

export const getStorefrontUserFromRequest = (c: Context) => {
  const userId = getCookie(c, "user_id");
  const guestId = getCookie(c, "guest_id");

  return userId ?? guestId;
};
