import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";
import { ActionCtx } from "../../../../_generated/server";
import { SYNTHETIC_MONITOR_ORIGIN } from "../../../../storeFront/syntheticMonitor";
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

  const appendArgs = buildServerContextTrackingEnvelope({
    body,
    storeId,
    organizationId,
    originHeader: c.req.header("origin"),
    syntheticHeader: c.req.header("x-athena-synthetic-monitor"),
    ipAddress: readTrackingIpAddress(
      c.req.header("x-forwarded-for"),
      c.req.header("x-real-ip"),
    ),
    storefrontActor: getStorefrontActorFromRequest(c),
  });

  const result = await c.env.runMutation(
    internal.contextTracking.contextEvents.appendContextEvent,
    appendArgs,
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

export function buildServerContextTrackingEnvelope(input: {
  body: Record<string, unknown>;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  originHeader?: string;
  syntheticHeader?: string;
  ipAddress?: string;
  storefrontActor?: { kind: "storefrontUser" | "guest"; id: unknown };
}) {
  const payload = readPayload(input.body.payload);
  const primarySubject = derivePrimarySubject(input.body.eventId, payload);
  const synthetic = isAcceptedSyntheticContext(input.body, input.syntheticHeader);
  const actorRef = input.storefrontActor
    ? {
        kind: input.storefrontActor.kind,
        id: String(input.storefrontActor.id),
      }
    : undefined;

  return {
    storeId: input.storeId,
    organizationId: input.organizationId,
    surface: "storefront" as const,
    eventId: readRequiredString(input.body.eventId),
    schemaVersion: readRequiredNumber(input.body.schemaVersion),
    idempotencyKey: readRequiredString(input.body.idempotencyKey),
    occurredAt: readRequiredNumber(input.body.occurredAt),
    origin: synthetic ? SYNTHETIC_MONITOR_ORIGIN : input.originHeader,
    payload,
    actorRef,
    sessionRef: undefined,
    primarySubject,
    subjectRefs: primarySubject ? [primarySubject] : undefined,
    sourceRefs: [],
    visibilityMode: "store_admin" as const,
    retentionClass: "standard" as const,
    synthetic,
    abusePartitionKey: buildAbusePartitionKey({
      storeId: input.storeId,
      actorRef,
    }),
  };
}

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

function isAcceptedSyntheticContext(
  body: Record<string, unknown>,
  syntheticHeader?: string,
) {
  return (
    body.origin === SYNTHETIC_MONITOR_ORIGIN &&
    syntheticHeader === "true"
  );
}

function readPayload(value: unknown) {
  return isRecord(value) ? value : {};
}

function readRequiredString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readRequiredNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readTrackingIpAddress(
  forwardedFor?: string,
  realIp?: string,
) {
  const firstForwarded = forwardedFor?.split(",", 1)[0]?.trim();
  return firstForwarded || realIp;
}

function buildAbusePartitionKey(input: {
  storeId: Id<"store">;
  actorRef?: { kind: "storefrontUser" | "guest"; id: string };
}) {
  if (input.actorRef) {
    return `${input.storeId}:actor:${input.actorRef.kind}:${input.actorRef.id}`;
  }
  return `${input.storeId}:anonymous`;
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
