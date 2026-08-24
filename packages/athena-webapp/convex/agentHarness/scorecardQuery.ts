/**
 * The harness scorecard query: is the agent getting better, per surface?
 *
 * PROFILE-NEUTRAL by design: it reads only the kernel tables every agent
 * surface shares (`agentTurnTraceEvent` through the trace leaf,
 * `agentCapabilityCall`, `agentProgramAttempt`, `agentBudgetLedger`,
 * `agentRunGrant`) and segments per profile from the grants, so a future
 * surface is scored the day it ships without touching this module. The
 * arithmetic lives in the pure `scorecard.ts`, which carries the test suite.
 *
 * Internal and run by hand (`bun run agent-harness:scorecard`), never a cron:
 * the reads are bounded but they are still whole-table recency scans.
 */
import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { aggregateHarnessScorecard, scorecardTraceTake } from "./scorecard";
import { takeRecentTurnTraceEventsWithCtx } from "./turnTrace";

export const describeHarnessScorecard = internalQuery({
  args: { turns: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const traceEvents = await takeRecentTurnTraceEventsWithCtx(ctx, scorecardTraceTake(args.turns));
    const calls = await ctx.db.query("agentCapabilityCall").order("desc").take(1_000);
    const attempts = await ctx.db.query("agentProgramAttempt").order("desc").take(400);
    const ledgers = await ctx.db.query("agentBudgetLedger").order("desc").take(200);
    const grants = await ctx.db.query("agentRunGrant").order("desc").take(400);
    return aggregateHarnessScorecard({
      traceEvents: traceEvents.map((event) => ({ runId: String(event.runId), kind: event.kind, at: event.at, payload: event.payload })),
      calls: calls.map((call) => ({ capabilityId: call.capabilityId, status: call.status, delegation: call.delegation as never })),
      attempts: attempts.map((attempt) => ({ status: attempt.status })),
      ledgers: ledgers.map((ledger) => ({ charged: ledger.charged as never, limits: ledger.limits as never })),
      grantProfiles: grants.map((grant) => ({ runId: String(grant.runId), profileKey: grant.profileKey })),
    });
  },
});
