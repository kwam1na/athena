import { v } from "convex/values";

import { internalQuery } from "../_generated/server";

const MAX_ACTIVITY_EVENTS = 2_000;

type SharedDemoActivityRow = {
  eventId: string;
  occurredAt: number;
  payload: Record<string, unknown>;
  actorRefId?: string;
  sessionRefId?: string;
};

export type SharedDemoActivityRollup = ReturnType<
  typeof foldSharedDemoActivity
>;

/**
 * Turns raw demo context events into the questions an operator actually asks:
 * how many people tried the demo, how far they got, what they completed, and
 * where they ran into a wall.
 *
 * A "visitor" is the auth user behind a demo principal — one per admission —
 * not the shared `athenaUser` every demo principal points at. A "session" is
 * one browser session, so a single visitor opening two tabs counts once as a
 * visitor and twice as a session.
 */
export function foldSharedDemoActivity(events: SharedDemoActivityRow[]) {
  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const surfaceVisitors = new Map<string, Set<string>>();
  const surfaceViews = new Map<string, number>();
  const visitorSurfaces = new Map<string, Set<string>>();
  const capabilityVisitors = new Map<string, Set<string>>();
  const capabilityActions = new Map<string, number>();
  const operationActions = new Map<string, number>();
  const deniedVisitors = new Map<string, Set<string>>();
  const deniedCounts = new Map<string, number>();
  const blockedVisitors = new Map<string, Set<string>>();
  const blockedCounts = new Map<string, number>();
  const actingVisitors = new Set<string>();
  let restoreInterruptions = 0;
  let observedFromAt: number | undefined;
  let observedToAt: number | undefined;

  for (const row of events) {
    const visitor = row.actorRefId ?? "unattributed";
    // Only a resolved actor counts as a visitor. Folding the synthetic
    // "unattributed" bucket into visitorCount would report one more person
    // than ever visited.
    if (row.actorRefId) visitors.add(row.actorRefId);
    if (row.sessionRefId) sessions.add(row.sessionRefId);
    observedFromAt =
      observedFromAt === undefined
        ? row.occurredAt
        : Math.min(observedFromAt, row.occurredAt);
    observedToAt =
      observedToAt === undefined
        ? row.occurredAt
        : Math.max(observedToAt, row.occurredAt);

    switch (row.eventId) {
      case "shared_demo.surface_viewed": {
        const surfaceKey = readText(row.payload.surfaceKey);
        if (!surfaceKey) break;
        addTo(surfaceVisitors, surfaceKey, visitor);
        increment(surfaceViews, surfaceKey);
        addTo(visitorSurfaces, visitor, surfaceKey);
        break;
      }
      case "shared_demo.action_admitted": {
        const capability = readText(row.payload.capability);
        const operationId = readText(row.payload.operationId);
        actingVisitors.add(visitor);
        if (capability) {
          addTo(capabilityVisitors, capability, visitor);
          increment(capabilityActions, capability);
        }
        if (operationId) increment(operationActions, operationId);
        break;
      }
      case "shared_demo.action_denied": {
        const surfaceKey = readText(row.payload.surfaceKey) ?? "unattributed";
        addTo(deniedVisitors, surfaceKey, visitor);
        increment(deniedCounts, surfaceKey);
        break;
      }
      case "shared_demo.surface_blocked": {
        const routeTemplate = readText(row.payload.routeTemplate);
        const reason = readText(row.payload.reason) ?? "unattributed";
        if (!routeTemplate) break;
        const key = `${routeTemplate}|${reason}`;
        addTo(blockedVisitors, key, visitor);
        increment(blockedCounts, key);
        break;
      }
      case "shared_demo.restore_observed": {
        if (readText(row.payload.phase) === "failed") restoreInterruptions += 1;
        break;
      }
    }
  }

  const depths = [...visitorSurfaces.values()].map((surfaces) => surfaces.size);

  return {
    observedFromAt,
    observedToAt,
    eventCount: events.length,
    visitorCount: visitors.size,
    sessionCount: sessions.size,
    surfacesReached: [...surfaceVisitors.entries()]
      .map(([surfaceKey, seen]) => ({
        surfaceKey,
        visitors: seen.size,
        views: surfaceViews.get(surfaceKey) ?? 0,
      }))
      .sort(byVisitorsThen("surfaceKey")),
    explorationDepth: {
      median: median(depths),
      max: depths.length === 0 ? 0 : Math.max(...depths),
    },
    actionsByCapability: [...capabilityVisitors.entries()]
      .map(([capability, seen]) => ({
        capability,
        visitors: seen.size,
        actions: capabilityActions.get(capability) ?? 0,
      }))
      .sort(byVisitorsThen("capability")),
    topOperations: [...operationActions.entries()]
      .map(([operationId, actions]) => ({ operationId, actions }))
      .sort((a, b) => b.actions - a.actions || a.operationId.localeCompare(b.operationId)),
    deniedActions: [...deniedVisitors.entries()]
      .map(([surfaceKey, seen]) => ({
        surfaceKey,
        visitors: seen.size,
        denials: deniedCounts.get(surfaceKey) ?? 0,
      }))
      .sort(byVisitorsThen("surfaceKey")),
    blockedSurfaces: [...blockedVisitors.entries()]
      .map(([key, seen]) => {
        const [routeTemplate, reason] = key.split("|");
        return {
          routeTemplate,
          reason,
          visitors: seen.size,
          hits: blockedCounts.get(key) ?? 0,
        };
      })
      .sort(byVisitorsThen("routeTemplate")),
    restoreInterruptions,
    visitorsWhoActed: actingVisitors.size,
    // Reached a surface but never completed an admitted action. This is the
    // drop-off signal: interest without a completed operation.
    visitorsWhoOnlyLooked: [...visitorSurfaces.keys()].filter(
      (visitor) => !actingVisitors.has(visitor),
    ).length,
  };
}

export const getSharedDemoActivityRollup = internalQuery({
  args: {
    storeId: v.id("store"),
    windowStartAt: v.number(),
    windowEndAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SharedDemoActivityRollup> => {
    const windowEndAt = args.windowEndAt;
    // The window bound belongs in the index range, not in a post-filter. A
    // take-then-filter drops every in-window row whenever more than
    // MAX_ACTIVITY_EVENTS rows sit after windowEndAt, which reads as "nothing
    // happened" for a window that was actually full.
    const events = await ctx.db
      .query("contextEvent")
      .withIndex("by_storeId_surface_status_occurredAt", (q) => {
        const scoped = q
          .eq("storeId", args.storeId)
          .eq("surface", "shared_demo")
          .eq("status", "recorded")
          .gte("occurredAt", args.windowStartAt);
        return windowEndAt === undefined
          ? scoped
          : scoped.lte("occurredAt", windowEndAt);
      })
      .order("desc")
      .take(MAX_ACTIVITY_EVENTS);

    return foldSharedDemoActivity(events);
  },
});

function addTo(target: Map<string, Set<string>>, key: string, value: string) {
  const existing = target.get(key);
  if (existing) existing.add(value);
  else target.set(key, new Set([value]));
}

function increment(target: Map<string, number>, key: string) {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function byVisitorsThen<Key extends string>(tieBreaker: Key) {
  return (
    a: { visitors: number } & Record<Key, string>,
    b: { visitors: number } & Record<Key, string>,
  ) => b.visitors - a.visitors || a[tieBreaker].localeCompare(b[tieBreaker]);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function readText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
