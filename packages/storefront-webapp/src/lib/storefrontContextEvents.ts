import {
  buildContextEventEnvelope,
  defineSurfaceContext,
  type ContextEventInput,
  type ContextPayload,
  type ContextPrimitiveValue,
  type ContextTrackingEnvelope,
} from "@athena/webapp/shared/intelligence";

import { postTrackingEvent } from "@/api/trackingEvents";
import type {
  StorefrontObservabilityBaseContext,
  StorefrontObservabilityEvent,
} from "@/lib/storefrontObservability";

type StorefrontContextEventId =
  | "storefront.route_viewed"
  | "storefront.product_viewed"
  | "storefront.cart_changed"
  | "storefront.checkout_state_changed";

type StorefrontContextEventDefinition = {
  eventId: StorefrontContextEventId;
  requiredPayloadKeys?: readonly string[];
  allowedPayloadKeys: readonly string[];
};

type StorefrontContextTrackingResult =
  | { ok: true; skipped: false; result: unknown }
  | { ok: true; skipped: true }
  | { ok: false; skipped: false; error: string };

type StorefrontContextTransport = (
  envelope: ContextTrackingEnvelope,
) => Promise<unknown>;

const STOREFRONT_CONTEXT_SYNTHETIC_ORIGIN = "synthetic_monitor";

const storefrontContextEventDefinitions: readonly StorefrontContextEventDefinition[] =
  [
    {
      eventId: "storefront.route_viewed",
      requiredPayloadKeys: ["route"],
      allowedPayloadKeys: ["route", "referrer", "utmSource", "promoCodeId"],
    },
    {
      eventId: "storefront.product_viewed",
      requiredPayloadKeys: ["productId"],
      allowedPayloadKeys: ["productId", "productSlug", "categorySlug", "sku"],
    },
    {
      eventId: "storefront.cart_changed",
      allowedPayloadKeys: ["cartId", "productId", "quantity", "change"],
    },
    {
      eventId: "storefront.checkout_state_changed",
      allowedPayloadKeys: ["checkoutSessionId", "state", "orderId", "blocker"],
    },
  ];

export const storefrontContextSurface = defineSurfaceContext({
  surface: "storefront",
  schemaVersion: 1,
  events: [
    {
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      requiredPayloadKeys: ["route"],
    },
    {
      eventId: "storefront.product_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      primarySubjectType: "product",
      requiredPayloadKeys: ["productId"],
    },
    {
      eventId: "storefront.cart_changed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
    },
    {
      eventId: "storefront.checkout_state_changed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
    },
  ],
});

export function buildStorefrontContextEvent(
  input: ContextEventInput,
  options: {
    sessionId?: string;
  } = {},
) {
  validateStorefrontContextPayload(input);

  return buildContextEventEnvelope(storefrontContextSurface, input, {
    sessionRef: options.sessionId
      ? {
          kind: "storefront_session",
          id: options.sessionId,
        }
      : undefined,
  });
}

export function createStorefrontRouteViewedContextEvent({
  baseContext,
}: {
  baseContext: StorefrontObservabilityBaseContext;
}) {
  return {
    eventId: "storefront.route_viewed",
    payload: {
      route: baseContext.route,
    },
    idempotencyKey: buildStorefrontIdempotencyKey({
      sessionId: baseContext.sessionId,
      eventId: "storefront.route_viewed",
      parts: [baseContext.route],
    }),
  } satisfies ContextEventInput;
}

export function createStorefrontContextTrackingEnvelope({
  event,
  eventInput,
  baseContext,
}: {
  event?: StorefrontObservabilityEvent;
  eventInput?: ContextEventInput;
  baseContext: StorefrontObservabilityBaseContext;
}) {
  const input =
    eventInput ??
    (event ? getStorefrontContextEventInput({ event, baseContext }) : undefined);

  if (!input) {
    return undefined;
  }

  return buildStorefrontContextEvent(
    {
      ...input,
      environment: baseContext.viewportBucket
        ? { viewportBucket: baseContext.viewportBucket }
        : undefined,
      origin: input.origin ?? baseContext.origin,
      synthetic:
        input.synthetic ??
        (baseContext.origin === STOREFRONT_CONTEXT_SYNTHETIC_ORIGIN
          ? true
          : undefined),
    },
    {
      sessionId: baseContext.sessionId,
    },
  );
}

export function getStorefrontContextEventInput({
  event,
  baseContext,
}: {
  event: StorefrontObservabilityEvent;
  baseContext: StorefrontObservabilityBaseContext;
}): ContextEventInput | undefined {
  const context = event.context ?? {};

  if (
    event.journey === "product_discovery" &&
    event.step === "product_detail" &&
    event.status === "viewed"
  ) {
    const productId = getString(context.productId);
    if (!productId) return undefined;
    const sku = getString(context.productSku);

    return {
      eventId: "storefront.product_viewed",
      payload: compactScalarPayload({
        productId,
        productSlug: getString(context.productSlug),
        categorySlug: getString(context.categorySlug),
        sku,
      }),
      primarySubject: {
        type: "product",
        id: productId,
      },
      subjectRefs: [{ type: "product", id: productId }],
      idempotencyKey: buildStorefrontIdempotencyKey({
        sessionId: baseContext.sessionId,
        eventId: "storefront.product_viewed",
        parts: [productId, sku],
      }),
    };
  }

  if (event.journey === "bag" && event.step === "checkout_start") {
    return getCheckoutContextEventInput({ event, baseContext });
  }

  if (event.journey === "bag") {
    return getCartContextEventInput({ event, baseContext });
  }

  if (event.journey === "checkout") {
    return getCheckoutContextEventInput({ event, baseContext });
  }

  return undefined;
}

export async function trackStorefrontContextEvent({
  event,
  eventInput,
  baseContext,
  transport = postTrackingEvent,
}: {
  event?: StorefrontObservabilityEvent;
  eventInput?: ContextEventInput;
  baseContext: StorefrontObservabilityBaseContext;
  transport?: StorefrontContextTransport;
}): Promise<StorefrontContextTrackingResult> {
  try {
    const envelope = createStorefrontContextTrackingEnvelope({
      event,
      eventInput,
      baseContext,
    });

    if (!envelope) {
      return { ok: true, skipped: true };
    }

    const result = await transport(envelope);

    return { ok: true, skipped: false, result };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : "Unknown tracking error",
    };
  }
}

function getCartContextEventInput({
  event,
  baseContext,
}: {
  event: StorefrontObservabilityEvent;
  baseContext: StorefrontObservabilityBaseContext;
}): ContextEventInput | undefined {
  const context = event.context ?? {};
  const cartId = getString(context.bagId);
  const productId = getString(context.productId);
  const quantity = getNumber(context.quantity);
  const change = getCartChange(event);

  if (!change) return undefined;

  return {
    eventId: "storefront.cart_changed",
    payload: compactScalarPayload({
      cartId,
      productId,
      quantity,
      change,
    }),
    primarySubject: productId ? { type: "product", id: productId } : undefined,
    subjectRefs: productId ? [{ type: "product", id: productId }] : undefined,
    idempotencyKey: buildStorefrontIdempotencyKey({
      sessionId: baseContext.sessionId,
      eventId: "storefront.cart_changed",
      parts: [cartId, productId, change, quantity],
    }),
  };
}

function getCheckoutContextEventInput({
  event,
  baseContext,
}: {
  event: StorefrontObservabilityEvent;
  baseContext: StorefrontObservabilityBaseContext;
}): ContextEventInput | undefined {
  const context = event.context ?? {};
  const state = getCheckoutState(event);
  if (!state) return undefined;

  const checkoutSessionId = getString(context.checkoutSessionId);
  const orderId = getString(context.orderId);
  const blocker = getCheckoutBlocker(event);

  return {
    eventId: "storefront.checkout_state_changed",
    payload: compactScalarPayload({
      checkoutSessionId,
      state,
      orderId,
      blocker,
    }),
    primarySubject: orderId
      ? { type: "order", id: orderId }
      : checkoutSessionId
        ? { type: "checkout_session", id: checkoutSessionId }
        : undefined,
    subjectRefs: [
      checkoutSessionId
        ? { type: "checkout_session", id: checkoutSessionId }
        : undefined,
      orderId ? { type: "order", id: orderId } : undefined,
    ].filter((subject): subject is { type: string; id: string } =>
      Boolean(subject),
    ),
    idempotencyKey: buildStorefrontIdempotencyKey({
      sessionId: baseContext.sessionId,
      eventId: "storefront.checkout_state_changed",
      parts: [checkoutSessionId, orderId, state, blocker],
    }),
  };
}

function getCartChange(event: StorefrontObservabilityEvent) {
  if (event.step === "bag_view" && event.status === "viewed") return "viewed";
  if (event.step === "bag_add" && event.status === "succeeded") return "added";
  if (event.step === "bag_remove" && event.status === "succeeded") {
    return "removed";
  }
  if (event.step === "bag_move_to_saved" && event.status === "succeeded") {
    return "moved_to_saved";
  }

  return undefined;
}

function getCheckoutState(event: StorefrontObservabilityEvent) {
  if (event.step === "checkout_start" && event.status === "started") {
    return "started";
  }
  if (event.step === "checkout_details" && event.status === "viewed") {
    return "details_entered";
  }
  if (event.step === "order_review" && event.status === "viewed") {
    return "reviewing";
  }
  if (event.step === "payment_submission" && event.status === "started") {
    return "requires_action";
  }
  if (event.step === "payment_submission" && event.status === "blocked") {
    return "blocked";
  }
  if (event.step === "payment_submission" && event.status === "failed") {
    return "failed";
  }
  if (event.step === "payment_verification" && event.status === "started") {
    return "verification_required";
  }
  if (event.step === "checkout_completion" && event.status === "succeeded") {
    return "completed";
  }
  if (event.step === "checkout_completion" && event.status === "blocked") {
    return "blocked";
  }
  if (event.step === "checkout_completion" && event.status === "canceled") {
    return "canceled";
  }

  return undefined;
}

function getCheckoutBlocker(event: StorefrontObservabilityEvent) {
  if (event.status !== "blocked" && event.status !== "failed") return undefined;

  const errorCategory = event.error?.category;
  if (
    errorCategory === "network" ||
    errorCategory === "validation" ||
    errorCategory === "authorization" ||
    errorCategory === "server" ||
    errorCategory === "client_render"
  ) {
    return errorCategory;
  }

  return "unknown";
}

function validateStorefrontContextPayload(input: ContextEventInput) {
  const definition = storefrontContextEventDefinitions.find(
    (event) => event.eventId === input.eventId,
  );

  if (!definition) return;

  const payload = compactScalarPayload(input.payload ?? {});

  for (const key of definition.requiredPayloadKeys ?? []) {
    if (!(key in payload)) {
      throw new Error(`Missing payload key: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(input.payload ?? {})) {
    if (value === undefined) continue;
    if (!definition.allowedPayloadKeys.includes(key)) {
      throw new Error(`Unexpected payload key: ${key}`);
    }
    if (
      !isSafeScalarContextValue(value as ContextPrimitiveValue | undefined)
    ) {
      throw new Error(`Invalid payload value: ${key}`);
    }
  }
}

function compactScalarPayload(
  payload: Record<string, unknown>,
): ContextPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(
      (entry): entry is [string, ContextPrimitiveValue] =>
        isSafeScalarContextValue(entry[1] as ContextPrimitiveValue | undefined),
    ),
  ) as ContextPayload;
}

function isSafeScalarContextValue(
  value: ContextPrimitiveValue | undefined,
): value is string | number | boolean | null {
  if (typeof value === "string") return value.length > 0 && value.length <= 200;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean" || value === null) return true;

  return false;
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildStorefrontIdempotencyKey({
  sessionId,
  eventId,
  parts,
}: {
  sessionId: string;
  eventId: StorefrontContextEventId;
  parts: readonly unknown[];
}) {
  return ["storefront", eventId, sessionId, ...parts.map(normalizeKeyPart)].join(
    ":",
  );
}

function normalizeKeyPart(part: unknown) {
  if (typeof part === "string" && part.length > 0) return part;
  if (typeof part === "number" && Number.isFinite(part)) return String(part);
  if (typeof part === "boolean") return String(part);

  return "none";
}
