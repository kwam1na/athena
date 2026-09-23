import { v, type Infer } from "convex/values";

export const posUploadPageDiagnosticsValidator = v.object({
  version: v.literal(1),
  startedAt: v.number(),
  completedAt: v.number(),
  pageSize: v.literal(250),
  includeReviewEvents: v.literal(false),
  pages: v.array(
    v.object({
      terminalId: v.string(),
      pageIndex: v.number(),
      afterSequence: v.optional(v.number()),
      fullPage: v.boolean(),
      events: v.array(
        v.object({
          localEventId: v.string(),
          type: v.string(),
          sequence: v.number(),
          uploadSequence: v.optional(v.number()),
          syncStatus: v.string(),
          uploaded: v.optional(v.boolean()),
          activityStatus: v.optional(v.string()),
          activityReasonCode: v.optional(v.string()),
          drainCandidate: v.boolean(),
          activityCandidate: v.boolean(),
        }),
      ),
    }),
  ),
});

export type PosUploadPageDiagnostics = Infer<
  typeof posUploadPageDiagnosticsValidator
>;
