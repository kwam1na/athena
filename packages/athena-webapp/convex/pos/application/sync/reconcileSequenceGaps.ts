/**
 * Cloud-driven reconciliation for wedged POS upload-sequence cursors.
 *
 * `ingestLocalEvents` records a durable gap on the cursor whenever events are
 * parked behind a missing predecessor. This sweep is what eventually does
 * something about it, so a terminal is never left waiting on a human to notice
 * a `sync_stuck` email.
 *
 * Per gapped cursor the ladder is: gather what the terminal says about the
 * missing sequence, ask `decideSequenceGapPolicy` what that warrants, then
 * either probe the terminal, step over the hole, or leave it alone. All of the
 * thresholds and the refusal rules live in `sequenceGapPolicy`; this module is
 * the I/O around that decision.
 *
 * Stepping over a hole re-projects the held successors and records a
 * `sequence_gap_skipped` conflict naming every sequence that was passed. That
 * conflict is the whole safety story: history moves again, and if one of those
 * burned sequences was a real sale, it surfaces as a drawer discrepancy for a
 * manager instead of silently never existing.
 */

import { v } from "convex/values";

import type { Doc, Id } from "../../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../../_generated/server";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";
import { createTerminalRecoveryCommandRepository } from "../../infrastructure/repositories/terminalRecoveryRepository";
import { issueTerminalRecoveryCommand } from "../terminalRecovery/terminalCommandService";
import { parseStoredLocalSyncEvent } from "./ingestLocalEvents";
import { projectLocalSyncEvent } from "./projectLocalEvents";
import {
  decideSequenceGapAction,
  type SequenceGapDecision,
  type SequenceGapState,
  type SequenceGapTerminalEvidence,
} from "./sequenceGapPolicy";

/** Cursors reconciled per sweep. Bounded to keep the mutation well inside limits. */
const GAP_SWEEP_CURSOR_LIMIT = 20;

/** Held successors re-projected per skip. A wedge this deep needs a human. */
const GAP_SKIP_EVENT_LIMIT = 50;

const SEQUENCE_GAP_CONFLICT_SUMMARY =
  "POS history was reconciled past upload sequences the terminal no longer has.";

const SEQUENCE_GAP_PROBE_REASON =
  "Cloud sync is waiting on an upload sequence this terminal has not delivered.";

export type SequenceGapReconciliationOutcome = {
  cursorId: Id<"posLocalSyncCursor">;
  terminalId: Id<"posTerminal">;
  decision: SequenceGapDecision["kind"];
  detail: string;
  reprojectedEventCount?: number;
  skippedSequences?: number[];
};

export const reconcilePosLocalSyncSequenceGaps = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(args.limit ?? GAP_SWEEP_CURSOR_LIMIT, GAP_SWEEP_CURSOR_LIMIT);
    const dryRun = args.dryRun === true;

    // Cursors without a gap sort below every timestamp on this index, so the
    // lower bound skips them without reading them.
    const gappedCursors = await ctx.db
      .query("posLocalSyncCursor")
      .withIndex("by_gap_first_observed", (q) =>
        q.gt("gap.firstObservedAt", 0),
      )
      .take(limit);

    const outcomes: SequenceGapReconciliationOutcome[] = [];

    for (const cursor of gappedCursors) {
      const gap = cursor.gap;
      if (!gap) continue;

      const heldEvents = await listHeldEventsForCursor(ctx, cursor);
      const evidence = await collectTerminalEvidence(ctx, {
        cursor,
        missingFromSequence: gap.missingFromSequence,
      });

      const decision = decideSequenceGapAction({
        gap,
        heldSequences: heldEvents.map((event) => event.sequence),
        evidence,
        now,
      });

      if (decision.kind === "wait") {
        outcomes.push({
          cursorId: cursor._id,
          terminalId: cursor.terminalId,
          decision: "wait",
          detail: decision.reason,
        });
        continue;
      }

      if (dryRun) {
        outcomes.push({
          cursorId: cursor._id,
          terminalId: cursor.terminalId,
          decision: decision.kind,
          detail: "dry_run",
          ...(decision.kind === "skip"
            ? { skippedSequences: decision.skippedSequences }
            : {}),
        });
        continue;
      }

      if (decision.kind === "probe") {
        const detail = await issueGapProbe(ctx, {
          cursor,
          gap,
          missingFromSequence: decision.missingFromSequence,
          now,
        });
        outcomes.push({
          cursorId: cursor._id,
          terminalId: cursor.terminalId,
          decision: "probe",
          detail,
        });
        continue;
      }

      const skipResult = await skipSequenceGap(ctx, {
        cursor,
        decision,
        heldEvents,
        now,
      });
      outcomes.push({
        cursorId: cursor._id,
        terminalId: cursor.terminalId,
        decision: "skip",
        detail: decision.reason,
        reprojectedEventCount: skipResult.reprojectedEventCount,
        skippedSequences: decision.skippedSequences,
      });
    }

    return { dryRun, now, outcomes, scannedCursorCount: gappedCursors.length };
  },
});

async function listHeldEventsForCursor(
  ctx: MutationCtx,
  cursor: Doc<"posLocalSyncCursor">,
): Promise<Doc<"posLocalSyncEvent">[]> {
  const events = await ctx.db
    .query("posLocalSyncEvent")
    .withIndex("by_store_terminal_register_sequence", (q) =>
      q
        .eq("storeId", cursor.storeId)
        .eq("terminalId", cursor.terminalId)
        .eq(
          "localRegisterSessionId",
          cursor.localSyncCursorId ?? cursor.localRegisterSessionId,
        )
        .gt("sequence", cursor.acceptedThroughSequence),
    )
    .take(GAP_SKIP_EVENT_LIMIT);

  return events.filter(
    (event) => event.status === "held" && event.heldReason === "out_of_order",
  );
}

/**
 * What the terminal has told us about the missing sequence, newest signal
 * first. Absence is only ever inferred from an enumeration the terminal
 * actually produced — never from silence, which is what the probe timeout is
 * for.
 */
async function collectTerminalEvidence(
  ctx: MutationCtx,
  args: {
    cursor: Doc<"posLocalSyncCursor">;
    missingFromSequence: number;
  },
): Promise<SequenceGapTerminalEvidence> {
  const runtimeStatus = await ctx.db
    .query("posTerminalRuntimeStatus")
    .withIndex("by_store_terminal", (q) =>
      q
        .eq("storeId", args.cursor.storeId)
        .eq("terminalId", args.cursor.terminalId),
    )
    .unique()
    .catch(() => null);

  // The heartbeat is the only source that inspects the *whole* local ledger,
  // so it is the only source that can prove absence.
  if (runtimeStatus !== null) {
    const sync = runtimeStatus.sync;
    if (sync.heldBehindMissingUploadSequence === args.missingFromSequence) {
      return { kind: "absent", observedAt: runtimeStatus.reportedAt };
    }
    // A terminal that says it is still waiting to upload, or waiting on a
    // review, is asserting it holds the awaited event. Skipping past a
    // sequence the terminal still has would strand real POS history.
    if (
      sync.heldBlockerKind === "awaiting_local_upload" ||
      sync.heldBlockerKind === "awaiting_review"
    ) {
      return { kind: "present", observedAt: runtimeStatus.reportedAt };
    }
  }

  const probeCommandId = args.cursor.gap?.probeCommandId;
  if (!probeCommandId) {
    return { kind: "unknown" };
  }

  const command = await ctx.db.get(
    "posTerminalRecoveryCommand",
    probeCommandId,
  );
  const enumeratedEvents = command?.acknowledgement?.localReviewEvents;
  if (
    command?.acknowledgement?.result !== "completed" ||
    enumeratedEvents === undefined
  ) {
    return { kind: "unknown" };
  }

  // `localReviewEvents` enumerates review-status events only, never the full
  // pending ledger. Finding the sequence there proves it is present; NOT
  // finding it proves nothing — a terminal with no review items returns an
  // empty list, and reading that as absence would skip live POS history on no
  // evidence at all.
  return enumeratedEvents.some(
    (event) => event.uploadSequence === args.missingFromSequence,
  )
    ? { kind: "present", observedAt: command.acknowledgement.acknowledgedAt }
    : { kind: "unknown" };
}

async function issueGapProbe(
  ctx: MutationCtx,
  args: {
    cursor: Doc<"posLocalSyncCursor">;
    gap: SequenceGapState;
    missingFromSequence: number;
    now: number;
  },
): Promise<string> {
  const result = await issueTerminalRecoveryCommand(
    createTerminalRecoveryCommandRepository(ctx),
    {
      commandType: "collect_local_review",
      commandContext: {
        localRegisterSessionId: args.cursor.localRegisterSessionId,
        missingUploadSequence: args.missingFromSequence,
        reason: SEQUENCE_GAP_PROBE_REASON,
      },
      expectedEvidence: { localReviewDetailsCollected: true },
      issuedAt: args.now,
      storeId: args.cursor.storeId,
      terminalId: args.cursor.terminalId,
    },
  );

  if (result.kind !== "ok") {
    // A terminal that cannot be commanded (deactivated, wrong store) must not
    // stall the sweep. Stamp the probe attempt anyway so the unanswered-probe
    // timeout still runs and the gap cannot wait forever on a dead terminal.
    await ctx.db.patch("posLocalSyncCursor", args.cursor._id, {
      gap: { ...args.gap, probeIssuedAt: args.now },
    });
    return `probe_failed:${result.error.code}`;
  }

  await ctx.db.patch("posLocalSyncCursor", args.cursor._id, {
    gap: {
      ...args.gap,
      probeIssuedAt: args.now,
      probeCommandId: result.data._id,
    },
  });

  return "probe_issued";
}

async function skipSequenceGap(
  ctx: MutationCtx,
  args: {
    cursor: Doc<"posLocalSyncCursor">;
    decision: Extract<SequenceGapDecision, { kind: "skip" }>;
    heldEvents: Doc<"posLocalSyncEvent">[];
    now: number;
  },
): Promise<{ reprojectedEventCount: number }> {
  const repository = createConvexLocalSyncRepository(ctx);
  const { cursor, decision, now } = args;

  // The conflict is written before any projection so a mid-sweep failure can
  // never leave reconciled history without its audit trail.
  const firstSuccessor = args.heldEvents.find(
    (event) => event.sequence === decision.skipThroughSequence + 1,
  );
  await repository.createConflict({
    storeId: cursor.storeId,
    terminalId: cursor.terminalId,
    localRegisterSessionId:
      cursor.localSyncCursorId ?? cursor.localRegisterSessionId,
    localEventId: firstSuccessor?.localEventId ?? "",
    sequence: decision.skipThroughSequence + 1,
    conflictType: "sequence_gap_skipped",
    status: "needs_review",
    summary: SEQUENCE_GAP_CONFLICT_SUMMARY,
    details: {
      reason: decision.reason,
      skippedSequences: decision.skippedSequences,
      skippedThroughSequence: decision.skipThroughSequence,
      previousAcceptedThroughSequence: cursor.acceptedThroughSequence,
      syncScope: cursor.syncScope ?? "pos",
    },
    createdAt: now,
  });

  // Advance past the hole and clear the gap. Held successors are re-projected
  // in sequence order; the first one that will not project cleanly stops the
  // run and leaves the rest held, so ordering is never violated.
  await ctx.db.patch("posLocalSyncCursor", cursor._id, {
    acceptedThroughSequence: decision.skipThroughSequence,
    updatedAt: now,
    gap: undefined,
  });

  let acceptedThroughSequence = decision.skipThroughSequence;
  let reprojectedEventCount = 0;

  for (const event of [...args.heldEvents].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (event.sequence !== acceptedThroughSequence + 1) {
      break;
    }

    const parsed = parseStoredLocalSyncEvent(repository, event);
    if (!parsed.ok) {
      break;
    }

    const projection = await projectLocalSyncEvent(repository, {
      storeId: event.storeId,
      terminalId: event.terminalId,
      event: parsed.event,
      syncEventId: event._id,
      now: event.acceptedAt ?? now,
      options: {
        allowClosedRegisterSaleProjection: true,
        allowReviewedInventorySaleProjection: true,
        trustStoredStaffProof: true,
      },
    });

    await repository.patchEvent(event._id, {
      status: projection.status,
      acceptedAt: event.acceptedAt ?? now,
      projectedAt: now,
      heldReason: undefined,
    });

    acceptedThroughSequence = event.sequence;
    reprojectedEventCount += 1;
  }

  if (acceptedThroughSequence !== decision.skipThroughSequence) {
    await ctx.db.patch("posLocalSyncCursor", cursor._id, {
      acceptedThroughSequence,
      updatedAt: now,
    });
  }

  return { reprojectedEventCount };
}
