import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { admitHttpRead } from "../../../../platform/operationAdmission";
import { getHomepageSnapshotRouteReadDefinition } from "../../../../operationAdmission/domains/u10_httpCustomer_readDefinitions";

const COOKIE_DOMAIN = "wigclub.store";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const HOMEPAGE_MERCHANDISING_BUCKET_MS = 60_000;
// Anonymous browse read: the snapshot carries no shopper-scoped data, so the
// internal sibling has no `owner` parameter at all — there is no ownership
// concept on this path, only the `storeId` that names what to render.
const homepageSnapshotQuery = internal.storeFront.homepageSnapshot.getInternal;

type CookieToSet = {
  name: string;
  value: string;
};

// NOT A GUEST MINT POINT. This route sets only the store context cookies.
// Guest sessions are minted — SIGNED — at exactly two places, `GET /storefront`
// and `GET /guests`; a third mint here used to hand out a bare, unsigned
// `guest_id` that no consumer accepted, and the storefront never bootstrapped a
// guest through this route (it always sent `asNewUser=false`). Anonymous
// browse needs no shopper identity, so this route carries none.
type HomepageSnapshotBootstrapArgs = {
  runQuery: ActionCtx["runQuery"];
  storeName?: string;
  nowMs: number;
};

const presentSnapshotAtRequestTime = (snapshot: any, nowMs: number) => {
  if (!snapshot) return snapshot;

  const bannerMessage =
    snapshot.bannerMessage?.countdownEndsAt !== undefined &&
    snapshot.bannerMessage.countdownEndsAt <= nowMs
      ? null
      : snapshot.bannerMessage;

  return {
    ...snapshot,
    ...(Object.prototype.hasOwnProperty.call(snapshot, "generatedAtMs")
      ? { generatedAtMs: nowMs }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(snapshot, "bannerMessage")
      ? { bannerMessage }
      : {}),
  };
};

export const resolveHomepageSnapshotBootstrap = async ({
  runQuery,
  storeName,
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

  const snapshot = await runQuery(homepageSnapshotQuery, {
    storeId: store._id as Id<"store">,
    nowMs:
      Math.floor(nowMs / HOMEPAGE_MERCHANDISING_BUCKET_MS) *
      HOMEPAGE_MERCHANDISING_BUCKET_MS,
  });

  return {
    status: 200,
    body: presentSnapshotAtRequestTime(snapshot, nowMs),
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

homepageSnapshotRoutes.get(
  "/",
  admitHttpRead(getHomepageSnapshotRouteReadDefinition, async (c) => {
    const result = await resolveHomepageSnapshotBootstrap({
      runQuery: c.env.runQuery,
      storeName: c.req.query("storeName"),
      nowMs: Date.now(),
    });

    for (const cookie of result.cookies) {
      setBootstrapCookie(c, cookie);
    }

    return c.json(result.body, result.status as 200 | 404);
  }),
);

export { homepageSnapshotRoutes };
