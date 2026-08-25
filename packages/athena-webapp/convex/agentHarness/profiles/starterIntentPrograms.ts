/**
 * Curated starter-intent programs (kernel-side registry; pure data, V8-safe).
 *
 * Keyed by `(profileId, starterIntentId)`. The intent's IDENTITY (id, label,
 * prompt) stays presentation-adapter data mirrored by the browser; its
 * PROGRAM lives only here, because the panel duplicates `starterIntents` and
 * a parity test enforces equality — program source on the presentation
 * contract would either break that guard or ship read topology to the
 * browser bundle (plan
 * `docs/plans/2026-08-24-001-feat-compiled-starter-intents-plan.md`, U1).
 *
 * Templates hole ONLY the profile's snapshot context keys as `{{key}}`;
 * `renderStarterIntentProgram` substitutes them fail-closed and the executor
 * re-validates the rendered source against the run's live facade before any
 * read. Profile conformance validates every entry against the full-tier
 * facade at definition time; an operator whose narrower grant rejects a
 * program at attempt-begin simply free-forms (a traced downgrade).
 *
 * Authoring rules the conformance suite enforces mechanically, and one it
 * cannot: every program must RETURN A STRUCTURED OBJECT with explicit
 * absent-capable fields — the executor rejects unstructured results, so a
 * bare-null return would turn "honest absence" into "failed → skip".
 */

export const AGENT_STARTER_INTENT_PROGRAMS: {
  readonly [profileId: string]: { readonly [starterIntentId: string]: string };
} = {
  daily_operations: {
    close_readiness: `const operatingDate = "{{operatingDate}}";
const [day, registers, attention, approvals, sales, automation, lowStock, outStock] = await Promise.all([
  athena.operations.storeDay.get({ operatingDate }),
  athena.cash.registerSessions.list({ operatingDate }),
  athena.operations.attention.list({ operatingDate }),
  athena.operations.approvals.list({ operatingDate, state: "pending" }),
  athena.reports.daySales.get({ operatingDate }),
  athena.automation.dailyOperations.list({ operatingDate }),
  athena.inventory.positions.list({ stockState: "low" }),
  athena.inventory.positions.list({ stockState: "out" }),
]);
const section = (result) => ({ outcome: result.kind, data: result.kind === "result" ? result.envelope.data : null });
return {
  operatingDate,
  storeDay: section(day),
  registerSessions: section(registers),
  attention: section(attention),
  pendingApprovals: section(approvals),
  daySales: section(sales),
  automation: section(automation),
  lowStock: section(lowStock),
  outOfStock: section(outStock),
};`,
    open_drawers: `const operatingDate = "{{operatingDate}}";
const sessions = await athena.cash.registerSessions.list({ operatingDate });
const rows = sessions.kind === "result" ? sessions.envelope.data : [];
return {
  operatingDate,
  outcome: sessions.kind,
  openSessions: rows.filter((row) => row.status === "open" || row.status === "active" || row.status === "closing"),
  closedSessions: rows.filter((row) => row.status === "closed").length,
  completeness: sessions.kind === "result" ? sessions.envelope.completeness.status : "unavailable",
};`,
    stock_pressure: `const [low, out, replenishment] = await Promise.all([
  athena.inventory.positions.list({ stockState: "low" }),
  athena.inventory.positions.list({ stockState: "out" }),
  athena.inventory.replenishment.list({}),
]);
const section = (result) => ({ outcome: result.kind, data: result.kind === "result" ? result.envelope.data : null });
return {
  lowStock: section(low),
  outOfStock: section(out),
  replenishment: section(replenishment),
};`,
    automation_today: `const operatingDate = "{{operatingDate}}";
const runs = await athena.automation.dailyOperations.list({ operatingDate });
return {
  operatingDate,
  outcome: runs.kind,
  actions: runs.kind === "result" ? runs.envelope.data : null,
  completeness: runs.kind === "result" ? runs.envelope.completeness.status : "unavailable",
};`,
  },
};

/** The curated program for one turn's intent, or undefined when none is registered. */
export function starterIntentProgramFor(profileId: string, starterIntentId: string): string | undefined {
  return AGENT_STARTER_INTENT_PROGRAMS[profileId]?.[starterIntentId];
}
