import type { Doc, Id } from "../_generated/dataModel";
import { STOREFRONT_OBSERVABILITY_ACTION } from "./storefrontObservabilityReport";

export { STOREFRONT_OBSERVABILITY_ACTION };

type AnalyticsDoc = Doc<"analytics"> & {
  userData?: {
    email?: string;
  };
  productInfo?: {
    name?: string;
    images?: string[];
    price?: number;
    currency?: string;
  };
};

type OperationalEventDoc = Partial<Doc<"operationalEvent">> & {
  _id: string;
  _creationTime?: number;
  createdAt?: number;
  message?: string;
  metadata?: Record<string, unknown>;
  onlineOrderId?: Id<"onlineOrder">;
  storeId: Id<"store">;
  subjectId?: string;
  subjectLabel?: string;
  subjectType?: string;
};

export type CustomerObservabilityTimelineEvent = {
  _id: string;
  _creationTime: number;
  action?: string;
  eventType?: string;
  message?: string;
  source: "observability" | "operations";
  storeFrontUserId?: Id<"storeFrontUser"> | Id<"guest">;
  storeId: Id<"store">;
  origin?: string;
  device?: string;
  journey: string;
  step: string;
  status: string;
  sessionId?: string;
  route?: string;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  productId?: Id<"product">;
  productSku?: string;
  checkoutSessionId?: string;
  orderId?: string;
  onlineOrderId?: Id<"onlineOrder">;
  subjectId?: string;
  subjectLabel?: string;
  subjectType?: string;
  userData?: {
    email?: string;
  };
  productInfo?: {
    name?: string;
    images?: string[];
    price?: number;
    currency?: string;
  };
};

export type CustomerObservabilityTimelineData = {
  summary: {
    totalEvents: number;
    uniqueSessions: number;
    failureCount: number;
    latestEvent?: {
      journey: string;
      step: string;
      status: string;
      _creationTime: number;
    };
  };
  events: CustomerObservabilityTimelineEvent[];
};

function getNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isFailureStatus(status: string) {
  return status === "failed" || status === "blocked";
}

function isOperationalEventDoc(
  event: AnalyticsDoc | OperationalEventDoc,
): event is OperationalEventDoc {
  return typeof (event as OperationalEventDoc).eventType === "string";
}

function getOperationalEventJourney(event: OperationalEventDoc) {
  return getNonEmptyString(event.subjectType) ?? "operations";
}

function getOperationalEventStep(event: OperationalEventDoc) {
  const eventType = getNonEmptyString(event.eventType);
  if (!eventType) {
    return "updated";
  }

  const journeyPrefix = `${getOperationalEventJourney(event)}_`;
  if (eventType.startsWith(journeyPrefix)) {
    return eventType.slice(journeyPrefix.length);
  }

  return eventType;
}

function getOperationalEventStatus(event: OperationalEventDoc) {
  const eventType = getNonEmptyString(event.eventType) ?? "";

  if (eventType.includes("cancel")) {
    return "canceled";
  }

  if (eventType.includes("refund")) {
    return "started";
  }

  return "succeeded";
}

function normalizeEvent(
  event: AnalyticsDoc | OperationalEventDoc,
): CustomerObservabilityTimelineEvent | null {
  if (isOperationalEventDoc(event)) {
    const journey = getOperationalEventJourney(event);
    const step = getOperationalEventStep(event);
    const status = getOperationalEventStatus(event);
    const createdAt = event.createdAt ?? event._creationTime;

    if (!createdAt) {
      return null;
    }

    return {
      _id: String(event._id),
      _creationTime: createdAt,
      eventType: getNonEmptyString(event.eventType),
      message: getNonEmptyString(event.message),
      source: "operations",
      storeId: event.storeId,
      journey,
      step,
      status,
      orderId: getNonEmptyString(event.subjectLabel),
      onlineOrderId: event.onlineOrderId,
      subjectId: getNonEmptyString(event.subjectId),
      subjectLabel: getNonEmptyString(event.subjectLabel),
      subjectType: getNonEmptyString(event.subjectType),
    };
  }

  const analyticsEvent = event;
  if (analyticsEvent.action !== STOREFRONT_OBSERVABILITY_ACTION) {
    return null;
  }

  const journey = getNonEmptyString(analyticsEvent.data?.journey);
  const step = getNonEmptyString(analyticsEvent.data?.step);
  const status = getNonEmptyString(analyticsEvent.data?.status);

  if (!journey || !step || !status) {
    return null;
  }

  return {
    _id: String(analyticsEvent._id),
    _creationTime: analyticsEvent._creationTime,
    action: analyticsEvent.action,
    source: "observability",
    storeFrontUserId: analyticsEvent.storeFrontUserId,
    storeId: analyticsEvent.storeId,
    origin: analyticsEvent.origin,
    device: analyticsEvent.device,
    journey,
    step,
    status,
    sessionId:
      getNonEmptyString(analyticsEvent.data?.sessionId) ??
      `unknown:${String(analyticsEvent._id)}`,
    route: getNonEmptyString(analyticsEvent.data?.route),
    errorCategory:
      getNonEmptyString(analyticsEvent.data?.errorCategory) ??
      (isFailureStatus(status) ? "unknown" : undefined),
    errorCode: getNonEmptyString(analyticsEvent.data?.errorCode),
    errorMessage: getNonEmptyString(analyticsEvent.data?.errorMessage),
    productId:
      analyticsEvent.productId ??
      (getNonEmptyString(analyticsEvent.data?.productId) as Id<"product"> | undefined),
    productSku: getNonEmptyString(analyticsEvent.data?.productSku),
    checkoutSessionId: getNonEmptyString(analyticsEvent.data?.checkoutSessionId),
    orderId: getNonEmptyString(analyticsEvent.data?.orderId),
    userData: analyticsEvent.userData,
    productInfo: analyticsEvent.productInfo,
  };
}

export function buildCustomerObservabilityTimeline(
  analyticsEvents: Array<AnalyticsDoc | OperationalEventDoc>,
): CustomerObservabilityTimelineData {
  const events = analyticsEvents
    .map(normalizeEvent)
    .filter((event): event is CustomerObservabilityTimelineEvent => event !== null)
    .sort((left, right) => right._creationTime - left._creationTime);

  const latestEvent = events[0];

  return {
    summary: {
      totalEvents: events.length,
      uniqueSessions: new Set(
        events
          .map((event) => event.sessionId)
          .filter((sessionId): sessionId is string => Boolean(sessionId))
      ).size,
      failureCount: events.filter((event) => isFailureStatus(event.status)).length,
      latestEvent: latestEvent
        ? {
            journey: latestEvent.journey,
            step: latestEvent.step,
            status: latestEvent.status,
            _creationTime: latestEvent._creationTime,
          }
        : undefined,
    },
    events,
  };
}
