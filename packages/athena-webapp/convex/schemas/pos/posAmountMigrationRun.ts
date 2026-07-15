import { v } from "convex/values";

/**
 * U10: durable, verifiable completion marker for the POS cedis→pesewas migration.
 * One record per migrated table records how many rows were converted/skipped and
 * whether the table has been fully migrated. This is the "migration ran to
 * completion" state the schema constraint-flip cutover is gated on — the schema
 * money validators must NOT be tightened until every POS table here reports
 * `complete: true` against production data.
 */
export const posAmountMigrationRunSchema = v.object({
  // POS table this run covers, e.g. "posTransaction".
  table: v.string(),
  // Records created strictly before this timestamp are treated as legacy cedis.
  cutoffTimestamp: v.number(),
  migrated: v.number(),
  skipped: v.number(),
  remaining: v.number(),
  complete: v.boolean(),
  updatedAt: v.number(),
});
