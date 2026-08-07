import {
  isSharedDemoSurfaceVisible,
  resolveAthenaViewRoute,
} from "./sharedDemoSurfaceCatalog";

const SHARED_DEMO_VISITOR_SESSION_KEY = "athena-shared-demo-session-v1";

type SessionStorage = Pick<Storage, "getItem" | "setItem">;
type ViewportBucket = "sm" | "md" | "lg" | "xl" | "unknown";

export type SharedDemoObservation = {
  eventId:
    | "shared_demo.session_started"
    | "shared_demo.surface_viewed"
    | "shared_demo.surface_blocked"
    | "shared_demo.action_denied"
    | "shared_demo.restore_observed";
  idempotencyKey: string;
  occurredAt: number;
  payload: Record<string, string | number>;
  schemaVersion: 1;
  sessionId: string;
  viewportBucket: ViewportBucket;
};

export function getOrCreateSharedDemoVisitorSession(
  storage: SessionStorage,
  randomUUID: () => string,
): string {
  const existing = storage.getItem(SHARED_DEMO_VISITOR_SESSION_KEY);
  if (existing) return existing;

  const sessionId = randomUUID();
  storage.setItem(SHARED_DEMO_VISITOR_SESSION_KEY, sessionId);
  return sessionId;
}

export function hasSharedDemoVisitorSession(storage: SessionStorage) {
  return storage.getItem(SHARED_DEMO_VISITOR_SESSION_KEY) !== null;
}

export function getSharedDemoViewportBucket(width: number): ViewportBucket {
  if (!Number.isFinite(width) || width <= 0) return "unknown";
  if (width < 640) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  return "xl";
}

/**
 * Describes where a visitor just landed, using the catalog's route template
 * instead of the pathname they actually visited. Org slugs, store slugs,
 * product slugs, and record ids never reach the payload.
 */
export function buildSharedDemoSurfaceObservation(input: {
  occurredAt: number;
  pathname: string;
  sessionId: string;
  viewportBucket: ViewportBucket;
}): SharedDemoObservation | null {
  const match = resolveAthenaViewRoute(input.pathname);

  if (!match) {
    return {
      eventId: "shared_demo.surface_blocked",
      idempotencyKey: `shared-demo:${input.sessionId}:surface_blocked:unknown_route`,
      occurredAt: input.occurredAt,
      payload: { routeTemplate: "/", reason: "unknown_route" },
      schemaVersion: 1,
      sessionId: input.sessionId,
      viewportBucket: input.viewportBucket,
    };
  }

  if (!isSharedDemoSurfaceVisible(input.pathname)) {
    return {
      eventId: "shared_demo.surface_blocked",
      idempotencyKey: `shared-demo:${input.sessionId}:surface_blocked:${match.surface}`,
      occurredAt: input.occurredAt,
      payload: {
        routeTemplate: match.routeTemplate,
        reason: "not_visible",
        surfaceKey: match.surface,
      },
      schemaVersion: 1,
      sessionId: input.sessionId,
      viewportBucket: input.viewportBucket,
    };
  }

  return {
    eventId: "shared_demo.surface_viewed",
    idempotencyKey: `shared-demo:${input.sessionId}:surface_viewed:${match.surface}`,
    occurredAt: input.occurredAt,
    payload: {
      surfaceKey: match.surface,
      routeTemplate: match.routeTemplate,
      presentation: match.presentation,
    },
    schemaVersion: 1,
    sessionId: input.sessionId,
    viewportBucket: input.viewportBucket,
  };
}

export function buildSharedDemoSessionStart(input: {
  baselineVersion: number;
  isNewSession: boolean;
  occurredAt: number;
  restoreEpoch: number;
  sessionId: string;
  viewportBucket: ViewportBucket;
}): SharedDemoObservation {
  const entryKind = input.isNewSession ? "fresh" : "resumed";

  return {
    eventId: "shared_demo.session_started",
    idempotencyKey: `shared-demo:${input.sessionId}:session_started:${entryKind}`,
    occurredAt: input.occurredAt,
    payload: {
      entryKind,
      baselineVersion: input.baselineVersion,
      restoreEpoch: input.restoreEpoch,
    },
    schemaVersion: 1,
    sessionId: input.sessionId,
    viewportBucket: input.viewportBucket,
  };
}

export function buildSharedDemoRestoreObservation(input: {
  epoch: number;
  occurredAt: number;
  phase: "restoring" | "ready" | "failed";
  sessionId: string;
  viewportBucket: ViewportBucket;
}): SharedDemoObservation {
  return {
    eventId: "shared_demo.restore_observed",
    // Keyed by epoch so a visitor who lives through two restores is counted
    // twice, while a re-render inside one restore is not.
    idempotencyKey: `shared-demo:${input.sessionId}:restore_observed:${input.phase}:${input.epoch}`,
    occurredAt: input.occurredAt,
    payload: { phase: input.phase, epoch: input.epoch },
    schemaVersion: 1,
    sessionId: input.sessionId,
    viewportBucket: input.viewportBucket,
  };
}

export function buildSharedDemoDenialObservation(input: {
  denialSequence: number;
  occurredAt: number;
  pathname: string;
  sessionId: string;
  viewportBucket: ViewportBucket;
}): SharedDemoObservation {
  const match = resolveAthenaViewRoute(input.pathname);

  return {
    eventId: "shared_demo.action_denied",
    // Every refusal matters: a visitor who tries the same blocked action four
    // times is telling us something a deduplicated single row would hide.
    idempotencyKey: `shared-demo:${input.sessionId}:action_denied:${input.denialSequence}`,
    occurredAt: input.occurredAt,
    payload: {
      reason: "demo_policy",
      ...(match
        ? { surfaceKey: match.surface, routeTemplate: match.routeTemplate }
        : {}),
    },
    schemaVersion: 1,
    sessionId: input.sessionId,
    viewportBucket: input.viewportBucket,
  };
}

/**
 * Keeps a browser from re-reporting an observation the rail would only
 * deduplicate anyway. The server's idempotency key is the correctness
 * boundary; this just avoids spending the visitor's write quota on it.
 */
export function createSharedDemoObservationLedger() {
  const reported = new Set<string>();

  return {
    shouldReport(observation: SharedDemoObservation) {
      if (reported.has(observation.idempotencyKey)) return false;
      reported.add(observation.idempotencyKey);
      return true;
    },
  };
}
