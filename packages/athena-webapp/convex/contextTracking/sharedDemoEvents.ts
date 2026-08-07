import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { getSharedDemoActorWithCtx } from "../sharedDemo/actor";
import { appendContextEventWithCtx } from "./contextEvents";

export const SHARED_DEMO_ACTIVITY_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const SHARED_DEMO_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SHARED_DEMO_IDEMPOTENCY_SUFFIX_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,120}$/;

/**
 * The events a demo browser may report. Actions that the server admits are
 * captured server-side instead (see `sharedDemoActionCapture.ts`), so this
 * list deliberately excludes `shared_demo.action_admitted`: a browser must not
 * be able to claim an operation it never performed.
 */
export const sharedDemoClientEventIdValidator = v.union(
  v.literal("shared_demo.session_started"),
  v.literal("shared_demo.surface_viewed"),
  v.literal("shared_demo.surface_blocked"),
  v.literal("shared_demo.action_denied"),
  v.literal("shared_demo.restore_observed"),
);

const viewportBucketValidator = v.union(
  v.literal("sm"),
  v.literal("md"),
  v.literal("lg"),
  v.literal("xl"),
  v.literal("unknown"),
);

export type SharedDemoActivity = {
  eventId: string;
  idempotencyKey: string;
  occurredAt: number;
  payload: Record<string, string | number>;
  schemaVersion: number;
  sessionId: string;
  viewportBucket: "sm" | "md" | "lg" | "xl" | "unknown";
};

type SharedDemoActivityActor = {
  authUserId: string;
  organizationId?: string;
  storeId: string;
};

export function validateSharedDemoActivity(
  activity: SharedDemoActivity,
  now = Date.now(),
): string | null {
  const prefix = `shared-demo:${activity.sessionId}:`;
  const suffix = activity.idempotencyKey.slice(prefix.length);

  if (
    !SHARED_DEMO_SESSION_ID_PATTERN.test(activity.sessionId) ||
    !activity.idempotencyKey.startsWith(prefix) ||
    !SHARED_DEMO_IDEMPOTENCY_SUFFIX_PATTERN.test(suffix) ||
    Math.abs(now - activity.occurredAt) >= SHARED_DEMO_ACTIVITY_CLOCK_SKEW_MS
  ) {
    return "Invalid demo activity envelope.";
  }

  return null;
}

export function buildSharedDemoActivityAppendArgs(
  activity: SharedDemoActivity,
  actor: SharedDemoActivityActor,
) {
  return {
    storeId: actor.storeId,
    organizationId: actor.organizationId,
    surface: "shared_demo" as const,
    eventId: activity.eventId,
    schemaVersion: activity.schemaVersion,
    // Namespaced by the server-resolved visitor, not by the client's session
    // alone. Idempotency uniqueness is scoped to storeId + surface + key, so a
    // browser that guessed another visitor's session id could otherwise
    // pre-claim their keys and have their real events dropped as duplicates.
    idempotencyKey: `shared-demo:${actor.authUserId}:${activity.idempotencyKey}`,
    occurredAt: activity.occurredAt,
    payload: activity.payload,
    // Every demo visitor shares one `athenaUser`, so that id cannot separate
    // visitors. The auth user behind the demo principal is per-visitor and is
    // resolved by the server, so a browser cannot attribute its activity to
    // another visitor. `sessionRef` below is the client's own claim and groups
    // tabs only — never trust it for identity.
    actorRef: { kind: "guest" as const, id: actor.authUserId },
    sessionRef: {
      kind: "shared_demo_session" as const,
      id: activity.sessionId,
    },
    visibilityMode: "support" as const,
    retentionClass: "standard" as const,
    environment: { viewportBucket: activity.viewportBucket },
    abusePartitionKey: `shared-demo:${actor.authUserId}`,
    // Demo behavior is operator telemetry, not merchant context. Keeping it
    // non-compilable stops it reaching store or user insight bundles.
    nonCompilable: true,
  };
}

export const recordSharedDemoActivity = mutation({
  args: {
    eventId: sharedDemoClientEventIdValidator,
    idempotencyKey: v.string(),
    occurredAt: v.number(),
    payload: v.record(v.string(), v.union(v.string(), v.number())),
    schemaVersion: v.literal(1),
    sessionId: v.string(),
    viewportBucket: viewportBucketValidator,
  },
  returns: v.object({
    kind: v.union(
      v.literal("recorded"),
      v.literal("duplicate"),
      v.literal("rejected"),
      v.literal("idempotency_conflict"),
    ),
    contextEventId: v.optional(v.id("contextEvent")),
    status: v.optional(v.union(v.literal("recorded"), v.literal("rejected"))),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, activity) => {
    const validationError = validateSharedDemoActivity(activity);
    if (validationError) {
      return { kind: "rejected" as const, message: validationError };
    }

    let actor;
    try {
      actor = await getSharedDemoActorWithCtx(ctx);
    } catch {
      // An expired or disabled demo session is a normal end state, not a
      // reportable failure. Drop the observation rather than surfacing an
      // error into a surface the visitor is already leaving.
      return { kind: "rejected" as const, message: "No active demo session." };
    }
    if (!actor) {
      return { kind: "rejected" as const, message: "No active demo session." };
    }

    return appendContextEventWithCtx(
      ctx,
      buildSharedDemoActivityAppendArgs(activity, {
        authUserId: actor.authUserId,
        organizationId: actor.organizationId,
        storeId: actor.storeId,
      }) as Parameters<typeof appendContextEventWithCtx>[1],
    );
  },
});
