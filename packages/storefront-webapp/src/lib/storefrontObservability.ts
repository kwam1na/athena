import { postAnalytics } from "@/api/analytics";
import { z } from "zod";

export const STOREFRONT_OBSERVABILITY_ACTION = "storefront_observability";
export const STOREFRONT_OBSERVABILITY_SCHEMA_VERSION = 1;
export const STOREFRONT_OBSERVABILITY_SESSION_KEY =
  "athena.storefront.observability.session_id";
export const SYNTHETIC_MONITOR_ORIGIN = "synthetic_monitor";

const stepPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const storefrontObservabilityJourneySchema = z.enum([
  "browse",
  "product_discovery",
  "bag",
  "checkout",
  "auth",
]);

export const storefrontObservabilityStatusSchema = z.enum([
  "viewed",
  "started",
  "succeeded",
  "failed",
  "blocked",
  "canceled",
]);

export const storefrontObservabilityUserTypeSchema = z.enum([
  "authenticated",
  "guest",
  "unknown",
]);

export const storefrontObservabilityErrorCategorySchema = z.enum([
  "network",
  "validation",
  "authorization",
  "server",
  "client_render",
  "unknown",
]);

const storefrontObservabilitySearchSchema = z.object({
  origin: z.string().optional(),
  utm_source: z.string().optional(),
});

const storefrontObservabilityBaseContextSchema = z.object({
  route: z.string().min(1).startsWith("/"),
  origin: z.string().optional(),
  sessionId: z.string().min(1),
  userType: storefrontObservabilityUserTypeSchema,
});

const storefrontObservabilityErrorSchema = z.object({
  category: storefrontObservabilityErrorCategorySchema,
  code: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

const storefrontObservabilityEventSchema = z.object({
  journey: storefrontObservabilityJourneySchema,
  step: z.string().regex(stepPattern, {
    message: "Observability steps must use snake_case names.",
  }),
  status: storefrontObservabilityStatusSchema,
  context: z.record(z.string(), z.unknown()).optional(),
  error: storefrontObservabilityErrorSchema.optional(),
});

export type StorefrontObservabilityJourney = z.infer<
  typeof storefrontObservabilityJourneySchema
>;
export type StorefrontObservabilityStatus = z.infer<
  typeof storefrontObservabilityStatusSchema
>;
export type StorefrontObservabilityUserType = z.infer<
  typeof storefrontObservabilityUserTypeSchema
>;
export type StorefrontObservabilityErrorCategory = z.infer<
  typeof storefrontObservabilityErrorCategorySchema
>;
export type StorefrontObservabilityEvent = z.infer<
  typeof storefrontObservabilityEventSchema
>;
export type StorefrontObservabilityBaseContext = z.infer<
  typeof storefrontObservabilityBaseContextSchema
>;

type StorefrontObservabilityRuntimeContext = {
  pathname: string;
  search?: {
    origin?: string;
    utm_source?: string;
  };
  userId?: string;
  guestId?: string;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

type StorefrontObservabilityTransportPayload = Parameters<
  typeof postAnalytics
>[0];

type StorefrontObservabilityTransport = (
  payload: StorefrontObservabilityTransportPayload,
) => Promise<unknown>;

export function isSyntheticMonitorOrigin(origin?: string | null) {
  return origin === SYNTHETIC_MONITOR_ORIGIN;
}

export function getOrCreateStorefrontObservabilitySessionId(
  storage?: Pick<Storage, "getItem" | "setItem">,
) {
  if (!storage) {
    return "server_render";
  }

  const existingSessionId = storage.getItem(
    STOREFRONT_OBSERVABILITY_SESSION_KEY,
  );

  if (existingSessionId) {
    return existingSessionId;
  }

  const sessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  storage.setItem(STOREFRONT_OBSERVABILITY_SESSION_KEY, sessionId);

  return sessionId;
}

export function createStorefrontObservabilityContext(
  runtimeContext: StorefrontObservabilityRuntimeContext,
): StorefrontObservabilityBaseContext {
  const search = storefrontObservabilitySearchSchema.parse(
    runtimeContext.search ?? {},
  );

  const userType: StorefrontObservabilityUserType = runtimeContext.userId
    ? "authenticated"
    : runtimeContext.guestId
      ? "guest"
      : "unknown";

  return storefrontObservabilityBaseContextSchema.parse({
    route: runtimeContext.pathname || "/",
    origin: search.origin ?? search.utm_source,
    sessionId: getOrCreateStorefrontObservabilitySessionId(
      runtimeContext.storage,
    ),
    userType,
  });
}

export function createStorefrontObservabilityPayload(
  event: StorefrontObservabilityEvent,
  baseContext: StorefrontObservabilityBaseContext,
): StorefrontObservabilityTransportPayload {
  const parsedEvent = storefrontObservabilityEventSchema.parse(event);
  const parsedBaseContext =
    storefrontObservabilityBaseContextSchema.parse(baseContext);

  const data: Record<string, unknown> = {
    schemaVersion: STOREFRONT_OBSERVABILITY_SCHEMA_VERSION,
    journey: parsedEvent.journey,
    step: parsedEvent.step,
    status: parsedEvent.status,
    route: parsedBaseContext.route,
    userType: parsedBaseContext.userType,
    sessionId: parsedBaseContext.sessionId,
    ...(parsedEvent.context ?? {}),
  };

  if (parsedEvent.error) {
    data.errorCategory = parsedEvent.error.category;
    data.errorCode = parsedEvent.error.code;
    data.errorMessage = parsedEvent.error.message;
  }

  return {
    action: STOREFRONT_OBSERVABILITY_ACTION,
    origin: parsedBaseContext.origin,
    data,
    productId:
      typeof parsedEvent.context?.productId === "string"
        ? parsedEvent.context.productId
        : undefined,
  };
}

export async function trackStorefrontEvent({
  event,
  baseContext,
  transport = postAnalytics,
}: {
  event: StorefrontObservabilityEvent;
  baseContext: StorefrontObservabilityBaseContext;
  transport?: StorefrontObservabilityTransport;
}) {
  const payload = createStorefrontObservabilityPayload(event, baseContext);

  return transport(payload);
}
