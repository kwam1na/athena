import { v } from "convex/values";

/**
 * Durable, verifiable completion marker for the POS cedis→pesewas migration.
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
  // Cumulative across every applying batch for this table.
  migrated: v.number(),
  // Cumulative across every applying batch for this table, same semantics as
  // `migrated` so two adjacent counters cannot be read two different ways.
  skipped: v.number(),
  // Whole-table rows still needing conversion, as measured by a dry run that
  // walked the entire table (or proven zero by a completed applying chain).
  //
  // OPTIONAL ON PURPOSE: absent means "never measured / measurement no longer
  // valid", which is NOT the same claim as a measured `0`. A required numeric
  // here forced first-touch applying batches — which have no measurement,
  // because an applying batch converts what it sees and its own pending count
  // is structurally zero — to write `0`, turning absence into a positive claim
  // of "no work left". Widening to optional is safe for rows at rest: every
  // existing record already carries a number.
  remaining: v.optional(v.number()),
  // When `remaining` was measured. Absent exactly when `remaining` is absent.
  remainingMeasuredAt: v.optional(v.number()),
  // Set when a run arrived with a different `cutoffTimestamp` than the record
  // already carried: the two runs measured different questions about the same
  // table. Held until a whole-table dry run re-measures at the current cutoff,
  // and while held no run may bank a `remaining` — including the zero a
  // completing chain would otherwise earn, since a chain handed a wrong cutoff
  // (e.g. `0`) finds nothing eligible and completes over an unconverted table.
  cutoffChangedAt: v.optional(v.number()),
  complete: v.boolean(),
  updatedAt: v.number(),
});
