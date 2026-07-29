import { v } from "convex/values";

/**
 * Run-ledger tables for the one-off athenaUser normalized-email backfill
 * (convex/migrations/backfillAthenaUserNormalizedEmail.ts).
 *
 * These kept their legacy "reporting*" table names because they were originally
 * declared alongside the reporting maintenance schemas, but the migration that
 * owns them has nothing to do with reporting. They are retained verbatim (table
 * names included, so existing rows stay addressable) now that the legacy
 * reporting layer is deleted. Renaming them is a separate migration.
 */

export const reportingIntegrityAttemptSchema = v.object({
  storeId: v.optional(v.id("store")),
  requestedStoreRef: v.optional(v.string()),
  operation: v.string(),
  outcome: v.union(
    v.literal("denied"),
    v.literal("conflict"),
    v.literal("invalid_version"),
  ),
  safeReason: v.string(),
  actorRef: v.optional(v.string()),
  occurredAt: v.number(),
});

export const reportingIdentityMigrationRunSchema = v.object({
  operation: v.union(
    v.literal("preview"),
    v.literal("apply"),
    v.literal("rollback"),
  ),
  automationIdentity: v.string(),
  previewRunId: v.optional(v.id("reportingIdentityMigrationRun")),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("blocked"),
  ),
  cursor: v.optional(v.string()),
  scannedCount: v.number(),
  changedCount: v.number(),
  conflictCount: v.number(),
  coverageComplete: v.optional(v.boolean()),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const reportingIdentityMigrationCandidateSchema = v.object({
  runId: v.id("reportingIdentityMigrationRun"),
  userId: v.id("athenaUser"),
  normalizedIdentityFingerprint: v.string(),
  action: v.union(
    v.literal("unchanged"),
    v.literal("update"),
    v.literal("conflict"),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
});

