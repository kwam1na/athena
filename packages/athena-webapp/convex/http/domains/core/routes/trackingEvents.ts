import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import { ActionCtx } from "../../../../_generated/server";
import {
  getStoreDataFromRequest,
  getStorefrontActorFromRequest,
} from "../../../utils";

const trackingEventRoutes: HonoWithConvex<ActionCtx> = new Hono();

trackingEventRoutes.post("/", async (c) => {
  if (!isAllowedTrackingOrigin(c.req.header("origin"))) {
    return c.json({ error: "Tracking origin not allowed" }, 403);
  }

  const { storeId, organizationId } = getStoreDataFromRequest(c);

  if (!storeId || !organizationId) {
    return c.json({ error: "Store or organization id missing" }, 400);
  }

  const body = await c.req.json();
  if (body.surface !== "storefront") {
    return c.json({ error: "Tracking surface not available on this route" }, 400);
  }

  const storefrontActor = getStorefrontActorFromRequest(c);
  const actorRef = storefrontActor
    ? { kind: storefrontActor.kind, id: String(storefrontActor.id) }
    : undefined;
  const primarySubject = derivePrimarySubject(body.eventId, body.payload ?? {});

  const result = await c.env.runMutation(
    internal.contextTracking.contextEvents.appendContextEvent,
    {
      storeId,
      organizationId,
      surface: body.surface,
      eventId: body.eventId,
      schemaVersion: body.schemaVersion,
      idempotencyKey: body.idempotencyKey,
      occurredAt: body.occurredAt,
      origin: body.origin,
      payload: body.payload ?? {},
      actorRef,
      sessionRef: sanitizeSessionRef(body.sessionRef),
      primarySubject,
      subjectRefs: primarySubject ? [primarySubject] : undefined,
      sourceRefs: [],
      visibilityMode: "store_admin",
      retentionClass: "standard",
      synthetic: false,
    },
  );

  if (result.kind === "rejected") {
    return c.json({ error: result.message ?? "Context event rejected" }, 400);
  }

  if (result.kind === "idempotency_conflict") {
    return c.json(
      { error: result.message ?? "Context event idempotency conflict" },
      409,
    );
  }

  return c.json(result);
});

export { trackingEventRoutes };

export function isAllowedTrackingOrigin(origin?: string) {
  if (!origin) return false;

  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "wigclub.store" ||
      hostname === "www.wigclub.store" ||
      hostname === "dev.wigclub.store" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function sanitizeSessionRef(value: unknown) {
  if (!isRecord(value) || value.kind !== "storefront_session") return undefined;
  if (typeof value.id !== "string" || value.id.length > 120) return undefined;

  return { kind: "storefront_session" as const, id: value.id };
}

export function derivePrimarySubject(
  eventId: unknown,
  payload: Record<string, unknown>,
) {
  if (eventId === "storefront.product_viewed") {
    return readSubjectRef(payload.productId, "product");
  }

  if (eventId === "storefront.cart_changed") {
    return readSubjectRef(payload.cartId, "cart");
  }

  if (eventId === "storefront.checkout_state_changed") {
    return (
      readSubjectRef(payload.checkoutSessionId, "checkoutSession") ??
      readSubjectRef(payload.orderId, "onlineOrder")
    );
  }

  return undefined;
}

function readSubjectRef(value: unknown, type: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    return undefined;
  }

  return { type, id: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
