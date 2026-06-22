import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { getStorefrontUserFromRequest } from "../../../utils";

const COOKIE_DOMAIN = "wigclub.store";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const homepageSnapshotQuery = api.storeFront.homepageSnapshot.get;

type CookieToSet = {
  name: string;
  value: string;
};

type HomepageSnapshotBootstrapArgs = {
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
  storeName?: string;
  marker?: string;
  asNewUser?: string;
  currentUserId?: string;
  nowMs: number;
};

const isDisplayableMarker = (marker?: string) => {
  return typeof marker === "string" && marker.trim().length > 0;
};

export const resolveHomepageSnapshotBootstrap = async ({
  runQuery,
  runMutation,
  storeName,
  marker,
  asNewUser,
  currentUserId,
  nowMs,
}: HomepageSnapshotBootstrapArgs): Promise<{
  status: number;
  body: unknown;
  cookies: CookieToSet[];
}> => {
  if (!storeName) {
    return {
      status: 404,
      body: { error: "Store name missing" },
      cookies: [],
    };
  }

  const store = await runQuery(internal.inventory.stores.findByName, {
    name: storeName,
  });

  if (!store) {
    return {
      status: 404,
      body: { error: "Store not found" },
      cookies: [],
    };
  }

  const cookies: CookieToSet[] = [
    { name: "organization_id", value: store.organizationId },
    { name: "store_id", value: store._id },
  ];

  if (!currentUserId && asNewUser === "true" && isDisplayableMarker(marker)) {
    let guest = await runQuery(internal.storeFront.guest.getByMarker, {
      marker,
    });

    if (!guest) {
      guest = await runMutation(internal.storeFront.guest.create, {
        marker,
        creationOrigin: "storefront",
        storeId: store._id,
        organizationId: store.organizationId,
      });
    }

    if (guest) {
      cookies.push({ name: "guest_id", value: guest._id });
    }
  }

  const snapshot = await runQuery(homepageSnapshotQuery, {
    storeId: store._id as Id<"store">,
    nowMs,
  });

  return {
    status: 200,
    body: snapshot,
    cookies,
  };
};

const setBootstrapCookie = (c: any, cookie: CookieToSet) => {
  setCookie(c, cookie.name, cookie.value, {
    path: "/",
    secure: true,
    domain: COOKIE_DOMAIN,
    httpOnly: true,
    sameSite: "None",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
};

const homepageSnapshotRoutes: HonoWithConvex<ActionCtx> = new Hono();

homepageSnapshotRoutes.get("/", async (c) => {
  const result = await resolveHomepageSnapshotBootstrap({
    runQuery: c.env.runQuery,
    runMutation: c.env.runMutation,
    storeName: c.req.query("storeName"),
    marker: c.req.query("marker"),
    asNewUser: c.req.query("asNewUser"),
    currentUserId: getStorefrontUserFromRequest(c),
    nowMs: Date.now(),
  });

  for (const cookie of result.cookies) {
    setBootstrapCookie(c, cookie);
  }

  return c.json(result.body, result.status as 200 | 404);
});

export { homepageSnapshotRoutes };
