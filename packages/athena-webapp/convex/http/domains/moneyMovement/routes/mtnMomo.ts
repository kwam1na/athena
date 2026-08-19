import { Hono } from "hono";

import {
  DEFAULT_INGRESS_MAX_BODY_BYTES,
  readBoundedRequestBody,
  requestWithBody,
} from "../../../../operationAdmission/ingressBody";
import { HonoWithConvex } from "convex-helpers/server/hono";
import type { Context } from "hono";
import { ActionCtx } from "../../../../_generated/server";
import { Id } from "../../../../_generated/dataModel";
import { internal } from "../../../../_generated/api";
import { parseCollectionsNotificationRequest } from "../../../../mtn/normalize";
import {
  MTN_MOMO_CALLBACK_SECRET_ENV,
  createMtnMomoCallbackVerifier,
} from "../../../../operationAdmission/ingressVerification";
import {
  mtnMomoCollectionsPostRouteOperationDefinition,
  mtnMomoCollectionsPutRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import { admitHttpRoute } from "../../../../platform/operationAdmission";
import type { AdmittedHttpContext } from "../../../../operationAdmission/rail";

const mtnMomoRoutes: HonoWithConvex<ActionCtx> = new Hono();

/**
 * Shared-secret check in front of the rail.
 *
 * MTN signs nothing, so the callback is authenticated by a secret we mint and
 * carry in the callback URL (`callbackSecret` query parameter) or a header.
 * The same verifier is declared on both definitions; this middleware exists to
 * keep the status contract a webhook caller can act on — 401 for a wrong or
 * missing secret, 503 when the secret is not configured — and to guarantee a
 * rejected callback leaves no admission row.
 */
mtnMomoRoutes.use("*", async (c, next) => {
  if (!process.env[MTN_MOMO_CALLBACK_SECRET_ENV]?.trim()) {
    return c.json({ error: "Callback verification is not configured" }, 503);
  }

  // Bounded HERE, not just in the rail. These are unauthenticated endpoints:
  // reading the body with `c.req.text()` before any credential is checked lets
  // an anonymous caller make the isolate buffer (and HMAC) an unbounded body,
  // and the rail's 413 would only fire after the whole thing had been read.
  const bounded = await readBoundedRequestBody(
    c.req.raw,
    DEFAULT_INGRESS_MAX_BODY_BYTES,
  );
  if (bounded.kind === "too_large") {
    return c.json({ error: "Request body too large." }, 413);
  }
  const rawBody = new TextDecoder().decode(bounded.bytes);
  const verified = await createMtnMomoCallbackVerifier()({
    headers: c.req.raw.headers,
    rawBody,
    request: c.req.raw,
  });

  if (!verified) {
    return c.json({ error: "Callback verification failed" }, 401);
  }

  // A Fetch body stream reads once. The rail reads `c.req.raw.body` directly,
  // not Hono's body cache, so without this reconstruction it would re-verify
  // an empty body and deny every genuine callback.
  c.req.raw = requestWithBody(c.req.raw, bounded.bytes);

  return next();
});

const handleCollectionNotification = async (
  c: Context,
  { ingress }: AdmittedHttpContext,
) => {
  const parsed = parseCollectionsNotificationRequest({
    // The verified bytes and the parsed bytes are the same string.
    rawBody: ingress.rawBody,
    headers: c.req.header(),
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

// One registered callback URL, two methods MTN may call it with: two ingress
// points, two definitions.
mtnMomoRoutes.post(
  "/collections",
  admitHttpRoute(
    mtnMomoCollectionsPostRouteOperationDefinition,
    handleCollectionNotification,
  ),
);

mtnMomoRoutes.put(
  "/collections",
  admitHttpRoute(
    mtnMomoCollectionsPutRouteOperationDefinition,
    handleCollectionNotification,
  ),
);

export { mtnMomoRoutes };
