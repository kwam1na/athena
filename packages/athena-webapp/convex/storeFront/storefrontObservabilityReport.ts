import type { Doc } from "../_generated/dataModel";
import { isSyntheticMonitorOrigin } from "./syntheticMonitor";

export const STOREFRONT_OBSERVABILITY_ACTION = "storefront_observability";

type AnalyticsDoc = Doc<"analytics">;

export type StorefrontObservabilityFunnelEntry = {
  journey: string;
  step: string;
  status: string;
  count: number;
  uniqueSessions: number;
  latestEventTime: number;
};

export type StorefrontObservabilityFailureCluster = {
  errorCategory: string;
  count: number;
  uniqueSessions: number;
  latestEventTime: number;
  trafficSource: "customer" | "synthetic_monitor" | "mixed";
  syntheticEvents: number;
  customerEvents: number;
  sessions: string[];
  sample: {
    journey: string;
    step: string;
    route?: string;
    origin?: string;
    errorCode?: string;
    errorMessage?: string;
  };
};

export type StorefrontObservabilityRecentEvent = {
  journey: string;
  step: string;
  status: string;
  sessionId: string;
  route?: string;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  origin?: string;
  isSyntheticMonitor: boolean;
  eventTime: number;
};

export type StorefrontObservabilityReport = {
  summary: {
    totalEvents: number;
    totalFailures: number;
    uniqueSessions: number;
    syntheticEvents: number;
    syntheticFailures: number;
  };
  funnel: StorefrontObservabilityFunnelEntry[];
  failureClusters: StorefrontObservabilityFailureCluster[];
  recentEvents: StorefrontObservabilityRecentEvent[];
};

type NormalizedObservabilityEvent = StorefrontObservabilityRecentEvent & {
  errorCategory: string;
};

function getNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function normalizeStorefrontObservabilityEvent(
  analyticsEvent: AnalyticsDoc,
): NormalizedObservabilityEvent | null {
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
    journey,
    step,
    status,
    sessionId:
      getNonEmptyString(analyticsEvent.data?.sessionId) ??
      `unknown:${String(analyticsEvent._id)}`,
    route: getNonEmptyString(analyticsEvent.data?.route),
    errorCategory:
      getNonEmptyString(analyticsEvent.data?.errorCategory) ?? "unknown",
    errorCode: getNonEmptyString(analyticsEvent.data?.errorCode),
    errorMessage: getNonEmptyString(analyticsEvent.data?.errorMessage),
    origin: analyticsEvent.origin,
    isSyntheticMonitor: isSyntheticMonitorOrigin(analyticsEvent.origin),
    eventTime: analyticsEvent._creationTime,
  };
}

function getTrafficSource({
  syntheticEvents,
  customerEvents,
}: {
  syntheticEvents: number;
  customerEvents: number;
}) {
  if (syntheticEvents > 0 && customerEvents > 0) {
    return "mixed" as const;
  }

  if (syntheticEvents > 0) {
    return "synthetic_monitor" as const;
  }

  return "customer" as const;
}

export function buildStorefrontObservabilityReport(
  analyticsEvents: AnalyticsDoc[],
): StorefrontObservabilityReport {
  const observabilityEvents = analyticsEvents
    .map(normalizeStorefrontObservabilityEvent)
    .filter((event): event is NormalizedObservabilityEvent => event !== null);

  const funnelMap = new Map<
    string,
    {
      journey: string;
      step: string;
      status: string;
      count: number;
      latestEventTime: number;
      sessions: Set<string>;
    }
  >();
  const failureClusterMap = new Map<
    string,
    {
      errorCategory: string;
      count: number;
      latestEventTime: number;
      syntheticEvents: number;
      customerEvents: number;
      sessions: Set<string>;
      sample: StorefrontObservabilityFailureCluster["sample"];
    }
  >();
  const uniqueSessions = new Set<string>();
  let syntheticEvents = 0;
  let syntheticFailures = 0;

  for (const event of observabilityEvents) {
    uniqueSessions.add(event.sessionId);
    if (event.isSyntheticMonitor) {
      syntheticEvents += 1;
    }

    const funnelKey = [event.journey, event.step, event.status].join("::");
    const funnelEntry = funnelMap.get(funnelKey) ?? {
      journey: event.journey,
      step: event.step,
      status: event.status,
      count: 0,
      latestEventTime: event.eventTime,
      sessions: new Set<string>(),
    };

    funnelEntry.count += 1;
    funnelEntry.latestEventTime = Math.max(
      funnelEntry.latestEventTime,
      event.eventTime,
    );
    funnelEntry.sessions.add(event.sessionId);
    funnelMap.set(funnelKey, funnelEntry);

    if (event.status !== "failed") {
      continue;
    }

    const clusterEntry = failureClusterMap.get(event.errorCategory) ?? {
      errorCategory: event.errorCategory,
      count: 0,
      latestEventTime: event.eventTime,
      syntheticEvents: 0,
      customerEvents: 0,
      sessions: new Set<string>(),
      sample: {
        journey: event.journey,
        step: event.step,
        route: event.route,
        origin: event.origin,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      },
    };

    clusterEntry.count += 1;
    if (event.isSyntheticMonitor) {
      clusterEntry.syntheticEvents += 1;
      syntheticFailures += 1;
    } else {
      clusterEntry.customerEvents += 1;
    }
    clusterEntry.latestEventTime = Math.max(
      clusterEntry.latestEventTime,
      event.eventTime,
    );
    clusterEntry.sessions.add(event.sessionId);
    failureClusterMap.set(event.errorCategory, clusterEntry);
  }

  const funnel = [...funnelMap.values()]
    .map((entry) => ({
      journey: entry.journey,
      step: entry.step,
      status: entry.status,
      count: entry.count,
      uniqueSessions: entry.sessions.size,
      latestEventTime: entry.latestEventTime,
    }))
    .sort((left, right) => {
      if (left.journey !== right.journey) {
        return left.journey.localeCompare(right.journey);
      }

      if (left.step !== right.step) {
        return left.step.localeCompare(right.step);
      }

      return left.status.localeCompare(right.status);
    });

  const failureClusters = [...failureClusterMap.values()]
    .map((entry) => ({
      errorCategory: entry.errorCategory,
      count: entry.count,
      uniqueSessions: entry.sessions.size,
      latestEventTime: entry.latestEventTime,
      trafficSource: getTrafficSource({
        syntheticEvents: entry.syntheticEvents,
        customerEvents: entry.customerEvents,
      }),
      syntheticEvents: entry.syntheticEvents,
      customerEvents: entry.customerEvents,
      sessions: [...entry.sessions].sort(),
      sample: entry.sample,
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return right.latestEventTime - left.latestEventTime;
    });

  return {
    summary: {
      totalEvents: observabilityEvents.length,
      totalFailures: observabilityEvents.filter(
        (event) => event.status === "failed",
      ).length,
      uniqueSessions: uniqueSessions.size,
      syntheticEvents,
      syntheticFailures,
    },
    funnel,
    failureClusters,
    recentEvents: observabilityEvents
      .slice()
      .sort((left, right) => right.eventTime - left.eventTime)
      .slice(0, 10),
  };
}
