/**
 * Declaration-side constants shared by domain capability manifests (V26-1267).
 *
 * Deliberately dependency-free apart from the browser-safe contracts: the
 * agent-SDK generator and the admission composition root both import the
 * declaration half of every package, and neither may drag domain read code (or
 * `convex/_generated`) into its module graph. Everything that touches the
 * database lives in the sibling `*Ports.ts` modules.
 */
import { budgetVector } from "../../shared/agentHarness/execution";

/** Worst case for a 100-item page: one call, a full page of rows, 192 KiB. */
export const AGENT_PAGE_COST = budgetVector({
  calls: 1,
  rows: 100,
  bytes: 196_608,
  costUnits: 3,
  elapsedMs: 2_500,
});

/** Worst case for a 50-item page. */
export const AGENT_SMALL_PAGE_COST = budgetVector({
  calls: 1,
  rows: 50,
  bytes: 98_304,
  costUnits: 2,
  elapsedMs: 2_000,
});

/** Worst case for one snapshot, covering the embedded items it declares. */
export const AGENT_SNAPSHOT_COST = budgetVector({
  calls: 1,
  rows: 120,
  bytes: 131_072,
  costUnits: 2,
  elapsedMs: 2_000,
});

/**
 * The ONLY time filter an agent may supply. A raw instant, a timezone, or a
 * UTC offset is rejected by `validateCapabilityManifest`
 * (`filter_kind_not_agent_callable`); the server derives the window through
 * `storeTime`, which owns DST and store-local day boundaries.
 */
export const OPERATING_DATE_FILTER = {
  kind: "operatingDate",
  required: true,
  meaning: "Operating date in the store's calendar; the server derives the window through store time.",
} as const;

/**
 * Every operating-day resource reports how its window was derived, so an
 * answer can say "calendar day, no schedule on file" instead of pretending the
 * store's own boundaries were used.
 */
export const OPERATING_WINDOW_FIELD = {
  kind: "object",
  meaning: "How the server derived this operating day's window.",
  fields: {
    derivation: {
      kind: "enum",
      values: ["schedule", "utc_fallback"],
      meaning:
        "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
    },
    timezone: { kind: "string", optional: true, meaning: "Store timezone the window was derived in." },
  },
} as const;
