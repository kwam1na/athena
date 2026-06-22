import type { Doc } from "../_generated/dataModel";
import { SYNTHETIC_MONITOR_ORIGIN } from "../storeFront/syntheticMonitor";

export type StorefrontContextAnalyticsRecord = {
  _id?: string;
  _creationTime: number;
  action: string;
  device?: string;
  productId?: string;
  storeFrontUserId?: string;
  contextEventId: string;
  contextSchemaVersion: number;
  payload: Record<string, string | number | boolean | null>;
  sourceTable: "analytics";
  sourceId?: string;
  synthetic: boolean;
};

type LegacyAnalyticsRow = Pick<
  Doc<"analytics">,
  | "_id"
  | "_creationTime"
  | "action"
  | "data"
  | "device"
  | "origin"
  | "productId"
  | "promoCodeId"
  | "storeFrontUserId"
>;

const STOREFRONT_OBSERVABILITY_ACTION = "storefront_observability";
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const SAFE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const SAFE_CAMPAIGN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const SAFE_STATUS_PATTERN = /^[a-z][a-z0-9_:-]{0,79}$/;
const SAFE_CHECKOUT_STATES = new Set([
  "viewed",
  "started",
  "succeeded",
  "failed",
  "blocked",
  "canceled",
  "initiated",
  "completed",
  "finalized",
]);
const SAFE_CHECKOUT_BLOCKERS = new Set([
  "network",
  "validation",
  "authorization",
  "server",
  "client_render",
  "inventory",
  "stock",
  "availability",
  "unknown",
]);
const SENSITIVE_TEXT_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
  /\b(?:token|secret|password|passwd|pwd|api[_-]?key|bearer|authorization|session|pin|otp)\b/i,
  /\b(?:card|cvv|cvc|pan|payment|external[_-]?reference|transaction[_-]?id)\b/i,
];

export function compileLegacyStorefrontAnalyticsRows(
  analytics: LegacyAnalyticsRow[],
) {
  return compileLegacyStorefrontAnalyticsRowsWithReport(analytics).contextRows;
}

export function compileLegacyStorefrontAnalyticsRowsWithReport(
  analytics: LegacyAnalyticsRow[],
) {
  const sourceRows = analytics.filter(
    (row) => row.origin !== SYNTHETIC_MONITOR_ORIGIN,
  );
  const contextRows = sourceRows
    .map(compileLegacyStorefrontAnalyticsRow)
    .filter((row): row is StorefrontContextAnalyticsRecord => row !== null);
  const omittedEvidenceCount = sourceRows.length - contextRows.length;

  return {
    sourceRowCount: sourceRows.length,
    contextRows,
    omittedEvidenceCount,
    qualityFlags: omittedEvidenceCount > 0 ? ["legacy_analytics_omitted"] : [],
  };
}

export function buildLegacyProductId(row: LegacyAnalyticsRow) {
  return (
    readSafeId(row.productId) ??
    readSafeId(row.data.productId) ??
    readSafeId(row.data.product)
  );
}

export function compileLegacyStorefrontAnalyticsRow(
  row: LegacyAnalyticsRow,
): StorefrontContextAnalyticsRecord | null {
  const eventId = resolveStorefrontContextEventId(row);
  if (!eventId) return null;

  const payload = buildLegacyContextPayload(row, eventId);
  if (isMissingRequiredPayload(eventId, payload)) return null;

  return {
    _id: String(row._id),
    _creationTime: row._creationTime,
    action: eventId,
    device: row.device,
    productId: buildLegacyProductId(row),
    storeFrontUserId: String(row.storeFrontUserId),
    contextEventId: eventId,
    contextSchemaVersion: 1,
    payload,
    sourceTable: "analytics",
    sourceId: String(row._id),
    synthetic: false,
  };
}

function resolveStorefrontContextEventId(row: LegacyAnalyticsRow) {
  if (row.action === STOREFRONT_OBSERVABILITY_ACTION) {
    return resolveObservabilityContextEventId(row.data);
  }

  const normalizedAction = row.action.toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalizedAction.includes("cart") ||
    normalizedAction.includes("bag") ||
    normalizedAction.includes("saved") ||
    normalizedAction === "add_to_cart"
  ) {
    return "storefront.cart_changed";
  }

  if (
    normalizedAction.includes("product") ||
    normalizedAction === "viewed_product"
  ) {
    return "storefront.product_viewed";
  }

  if (
    normalizedAction.includes("checkout") ||
    normalizedAction.includes("purchase") ||
    normalizedAction.includes("order")
  ) {
    return "storefront.checkout_state_changed";
  }

  return "storefront.route_viewed";
}

function resolveObservabilityContextEventId(data: Record<string, unknown>) {
  const journey = readString(data.journey);
  const step = readString(data.step);

  if (journey === "product_discovery" && step === "product_detail") {
    return "storefront.product_viewed";
  }

  if (journey === "bag") {
    return "storefront.cart_changed";
  }

  if (journey === "checkout") {
    return "storefront.checkout_state_changed";
  }

  return "storefront.route_viewed";
}

function buildLegacyContextPayload(
  row: LegacyAnalyticsRow,
  eventId: string,
): Record<string, string | number | boolean | null> {
  const data = row.data;

  if (eventId === "storefront.product_viewed") {
    return compactPayload({
      productId: buildLegacyProductId(row),
      productSlug: readSafeSlug(data.productSlug),
      categorySlug:
        readSafeSlug(data.categorySlug) ?? readSafeSlug(data.subcategorySlug),
      sku: readSafeSlug(data.sku) ?? readSafeSlug(data.productSku),
    });
  }

  if (eventId === "storefront.cart_changed") {
    return compactPayload({
      cartId: readSafeId(data.cartId) ?? readSafeId(data.bagId),
      productId: buildLegacyProductId(row),
      quantity: readNumber(data.quantity) ?? readNumber(data.itemCount),
      change: readSafeStatus(data.change) ?? buildCartChange(data),
    });
  }

  if (eventId === "storefront.checkout_state_changed") {
    return compactPayload({
      checkoutSessionId: readSafeId(data.checkoutSessionId),
      state:
        readCheckoutState(data.state) ??
        readCheckoutState(data.status) ??
        readCheckoutState(data.step),
      orderId: readSafeId(data.orderId),
      blocker:
        readCheckoutBlocker(data.blocker) ??
        readCheckoutBlocker(data.errorCategory),
    });
  }

  return compactPayload({
    route: readRoutePath(data.route) ?? "/",
    referrer: readReferrerOrigin(data.referrer),
    utmSource: readSafeCampaign(data.utmSource) ?? readSafeCampaign(data.utm_source),
    promoCodeId: readSafeId(row.promoCodeId) ?? readSafeId(data.promoCodeId),
  });
}

function isMissingRequiredPayload(
  eventId: string,
  payload: Record<string, string | number | boolean | null>,
) {
  if (eventId === "storefront.product_viewed") {
    return typeof payload.productId !== "string" || payload.productId.length === 0;
  }

  if (eventId === "storefront.route_viewed") {
    return typeof payload.route !== "string" || payload.route.length === 0;
  }

  return false;
}

function buildCartChange(data: Record<string, unknown>) {
  const status = readSafeStatus(data.status);
  const step = readSafeStatus(data.step);

  if (step === "bag_add" && status === "succeeded") return "added";
  if (step === "bag_remove" && status === "succeeded") return "removed";

  return status;
}

function compactPayload(input: Record<string, unknown>) {
  const payload: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0 && value.length <= 500) {
      payload[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      payload[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      payload[key] = value;
    }
  }

  return payload;
}

function readString(value: unknown) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500 || containsSensitiveText(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readSafeId(value: unknown) {
  const text = readRawString(value);
  return text && SAFE_ID_PATTERN.test(text) ? text : undefined;
}

function readSafeSlug(value: unknown) {
  const text = readString(value);
  return text && SAFE_SLUG_PATTERN.test(text) ? text : undefined;
}

function readSafeCampaign(value: unknown) {
  const text = readString(value);
  return text && SAFE_CAMPAIGN_PATTERN.test(text) ? text : undefined;
}

function readSafeStatus(value: unknown) {
  const text = readString(value)?.toLowerCase();
  return text && SAFE_STATUS_PATTERN.test(text) ? text : undefined;
}

function readCheckoutState(value: unknown) {
  const text = readSafeStatus(value);
  return text && SAFE_CHECKOUT_STATES.has(text) ? text : undefined;
}

function readCheckoutBlocker(value: unknown) {
  const text = readSafeStatus(value);
  return text && SAFE_CHECKOUT_BLOCKERS.has(text) ? text : undefined;
}

function readRoutePath(value: unknown) {
  const text = readRawString(value);
  if (!text) return undefined;

  try {
    const url = new URL(text, "https://storefront.local");
    return sanitizePathname(url.pathname);
  } catch {
    return sanitizePathname(text.split(/[?#]/, 1)[0]);
  }
}

function readReferrerOrigin(value: unknown) {
  const text = readRawString(value);
  if (!text) return undefined;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    const origin = `${url.protocol}//${url.hostname}`;
    return containsSensitiveText(origin) ? undefined : origin.slice(0, 120);
  } catch {
    return readRoutePath(text);
  }
}

function containsSensitiveText(value: string) {
  return SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function readRawString(value: unknown) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed && trimmed.length <= 500 ? trimmed : undefined;
}

function sanitizePathname(pathname: string) {
  if (!pathname.startsWith("/") || containsSensitiveText(pathname)) {
    return undefined;
  }

  return pathname.slice(0, 120);
}
