import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import { Id } from "../../../../_generated/dataModel";
import { internal } from "../../../../_generated/api";
import { parseCollectionsNotificationRequest } from "../../../../mtn/normalize";

const mtnMomoRoutes: HonoWithConvex<ActionCtx> = new Hono();

const handleCollectionNotification = async (c: any) => {
  const rawBody = await c.req.text();
  const parsed = parseCollectionsNotificationRequest({
    rawBody,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    query: {
      storeId: c.req.query("storeId"),
      providerReference: c.req.query("providerReference"),
    },
    method: c.req.raw.method,
  });

  if (!parsed.ok) {
    return c.json({ error: parsed.error }, parsed.statusCode);
  }

  const observedAt = Date.now();

  await c.env.runMutation(internal.mtn.collections.ingestNotification, {
    storeId: parsed.value.storeId as Id<"store">,
    providerReference: parsed.value.providerReference,
    statusPayload: parsed.value.payload as any,
    observedAt,
    callbackMetadata: {
      ...parsed.value.callbackMetadata,
      receivedAt: observedAt,
    },
  });

  return c.json({ message: "OK" });
};

mtnMomoRoutes.on(["POST", "PUT"], "/collections", handleCollectionNotification);

export { mtnMomoRoutes };
