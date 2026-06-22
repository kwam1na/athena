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

const SAFE_PUBLIC_TEXT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/;
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9/_:.-]{0,119}$/;
const SENSITIVE_TEXT_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
  /\b(?:token|secret|password|passwd|pwd|api[_-]?key|bearer|authorization|session|pin|otp)\b/i,
  /\b(?:card|cvv|cvc|pan|payment|external[_-]?reference|transaction[_-]?id|stripe|paypal)\b/i,
];
const CHECKOUT_STATE_CODES = new Set([
  "viewed",
  "started",
  "details_entered",
  "reviewing",
  "requires_action",
  "verification_required",
  "blocked",
  "failed",
  "canceled",
  "completed",
]);
const CHECKOUT_BLOCKER_CODES = new Set([
  "network",
  "validation",
  "authorization",
  "server",
  "client_render",
  "inventory",
  "stock",
  "availability",
  "payment_provider",
  "verification",
  "unknown",
]);

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
    if (!validatePayloadValue(key, value)) {
      return { ok: false as const, message: invalidPayloadMessage(key) };
    }
  }

  return { ok: true as const };
}

function invalidPayloadMessage(key: string) {
  return key === "route"
    ? "Unsafe payload value: route"
    : `Invalid payload value: ${key}`;
}

function isPublicContextValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length <= 120 && !containsSensitiveText(value);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || value === null) return true;

  return false;
}

function validatePayloadValue(key: string, value: unknown): boolean {
  if (!isPublicContextValue(value)) return false;
  if (typeof value !== "string") return true;

  if (key === "route") return SAFE_ROUTE_PATTERN.test(value);
  if (key === "state") return CHECKOUT_STATE_CODES.has(value);
  if (key === "blocker") return CHECKOUT_BLOCKER_CODES.has(value);

  return SAFE_PUBLIC_TEXT_PATTERN.test(value);
}

function containsSensitiveText(value: string) {
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}
