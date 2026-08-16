import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { recordDocsWorkspaceVisitOperationDefinition } from "../operationAdmission/domains/u9_platform_definitions";
import { admitPublicMutation } from "../platform/operationAdmission";
import { appendContextEventWithCtx } from "./contextEvents";

const viewportBucketValidator = v.union(
  v.literal("sm"),
  v.literal("md"),
  v.literal("lg"),
  v.literal("xl"),
  v.literal("unknown"),
);

type DocsWorkspaceVisit = {
  eventId: "athena_webapp.workspace_viewed";
  idempotencyKey: string;
  occurredAt: number;
  payload: { route: string; workspace: string };
  schemaVersion: 1;
  sessionId: string;
  viewportBucket: "sm" | "md" | "lg" | "xl" | "unknown";
};

const DOCS_VISIT_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const DOCS_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const DOCS_VISIT_IDEMPOTENCY_PATTERN = /^(anonymous|authenticated)$/;

export function validateDocsWorkspaceVisit(
  visit: DocsWorkspaceVisit,
  now = Date.now(),
): string | null {
  if (
    !DOCS_SESSION_ID_PATTERN.test(visit.sessionId) ||
    !visit.idempotencyKey.startsWith(`docs-workspace:${visit.sessionId}:`) ||
    !DOCS_VISIT_IDEMPOTENCY_PATTERN.test(
      visit.idempotencyKey.slice(`docs-workspace:${visit.sessionId}:`.length),
    ) ||
    Math.abs(now - visit.occurredAt) > DOCS_VISIT_CLOCK_SKEW_MS
  ) {
    return "Invalid docs workspace visit.";
  }

  return null;
}

export function buildDocsWorkspaceAppendArgs(
  visit: DocsWorkspaceVisit,
  actor: { athenaUserId?: string },
) {
  return {
    storeId: undefined,
    organizationId: undefined,
    surface: "athena_webapp" as const,
    eventId: visit.eventId,
    schemaVersion: visit.schemaVersion,
    idempotencyKey: visit.idempotencyKey,
    occurredAt: visit.occurredAt,
    payload: visit.payload,
    actorRef: actor.athenaUserId
      ? ({ kind: "athenaUser", id: actor.athenaUserId } as const)
      : ({ kind: "guest", id: visit.sessionId } as const),
    sessionRef: {
      kind: "athena_webapp_session" as const,
      id: visit.sessionId,
    },
    visibilityMode: "store_admin" as const,
    retentionClass: "standard" as const,
    environment: { viewportBucket: visit.viewportBucket },
    abusePartitionKey: `docs-workspace:${visit.sessionId}`,
    nonCompilable: true,
  };
}

export const recordDocsWorkspaceVisit = mutation({
  args: {
    eventId: v.literal("athena_webapp.workspace_viewed"),
    idempotencyKey: v.string(),
    occurredAt: v.number(),
    payload: v.object({
      route: v.literal("/docs"),
      workspace: v.literal("docs"),
    }),
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
  // Anonymous readers record visits too, so the definition admits `public`;
  // the OPTIONAL identity lookup below is what keeps an anonymous visit
  // attributed to its session rather than to a user.
  handler: admitPublicMutation(
    recordDocsWorkspaceVisitOperationDefinition,
    async (ctx, visit: DocsWorkspaceVisit) => {
      const validationError = validateDocsWorkspaceVisit(visit);
      if (validationError) {
        return { kind: "rejected" as const, message: validationError };
      }

      const athenaUser = await getAuthenticatedAthenaUserWithCtx(ctx);
      return appendContextEventWithCtx(
        ctx,
        buildDocsWorkspaceAppendArgs(visit, {
          athenaUserId: athenaUser?._id,
        }),
      );
    },
  ),
});
