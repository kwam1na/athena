import type { ContextTrackingSurface } from "./types";

export type ContextEventRegistration = {
  surface: ContextTrackingSurface;
  eventId: string;
  schemaVersion: number;
  requiredPayloadKeys?: readonly string[];
  allowedPayloadKeys: readonly string[];
  primarySubjectType?: string;
  visibilityMode: "store_admin" | "store_staff" | "support";
  retentionClass: "short_lived" | "standard" | "diagnostic";
};

const EVENT_REGISTRY: ContextEventRegistration[] = [
  {
    surface: "storefront",
    eventId: "storefront.route_viewed",
    schemaVersion: 1,
    requiredPayloadKeys: ["route"],
    allowedPayloadKeys: ["route", "referrer", "utmSource", "promoCodeId"],
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
  {
    surface: "storefront",
    eventId: "storefront.product_viewed",
    schemaVersion: 1,
    requiredPayloadKeys: ["productId"],
    allowedPayloadKeys: ["productId", "productSlug", "categorySlug", "sku"],
    primarySubjectType: "product",
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
  {
    surface: "storefront",
    eventId: "storefront.cart_changed",
    schemaVersion: 1,
    allowedPayloadKeys: ["cartId", "productId", "quantity", "change"],
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
  {
    surface: "storefront",
    eventId: "storefront.checkout_state_changed",
    schemaVersion: 1,
    allowedPayloadKeys: ["checkoutSessionId", "state", "orderId", "blocker"],
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
  {
    surface: "athena_webapp",
    eventId: "athena_webapp.workspace_viewed",
    schemaVersion: 1,
    requiredPayloadKeys: ["route"],
    allowedPayloadKeys: ["route", "workspace"],
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
  {
    surface: "athena_webapp",
    eventId: "athena_webapp.intelligence_surface_viewed",
    schemaVersion: 1,
    requiredPayloadKeys: ["capability"],
    allowedPayloadKeys: ["capability", "artifactId", "subjectId"],
    visibilityMode: "store_admin",
    retentionClass: "standard",
  },
];

export function findRegisteredContextEvent(input: {
  surface: ContextTrackingSurface;
  eventId: string;
  schemaVersion: number;
}) {
  return EVENT_REGISTRY.find(
    (event) =>
      event.surface === input.surface &&
      event.eventId === input.eventId &&
      event.schemaVersion === input.schemaVersion,
  );
}

export function validateRegisteredContextEventPayload(
  registration: ContextEventRegistration,
  payload: Record<string, unknown>,
) {
  for (const key of registration.requiredPayloadKeys ?? []) {
    if (!(key in payload)) {
      return { ok: false as const, message: `Missing payload key: ${key}` };
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!registration.allowedPayloadKeys.includes(key)) {
      return { ok: false as const, message: `Unexpected payload key: ${key}` };
    }
    if (!isPublicContextValue(value)) {
      return { ok: false as const, message: `Invalid payload value: ${key}` };
    }
  }

  return { ok: true as const };
}

function isPublicContextValue(value: unknown): boolean {
  if (typeof value === "string") return value.length <= 500;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || value === null) return true;

  return false;
}
