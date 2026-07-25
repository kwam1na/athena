/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../../../_generated/api";
import { submitTerminalRuntimeStatus } from "../commands/terminals";
import type { Id } from "../../../_generated/dataModel";
import schema from "../../../schema";
import {
  SEQUENCE_GAP_PROBE_AFTER_MS,
  SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS,
} from "./sequenceGapPolicy";

// Keys must be relative to the convex root for convex-test's module resolver;
// this file sits three levels below it.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../../../")
      ? path.replace(/^\.\.\/\.\.\/\.\.\//, "./")
      : path.replace(/^\.\//, "./pos/application/sync/"),
    loader,
  ]),
);

const CURSOR_ID = "local-register-terminal-1-session-a";

/**
 * Reproduces the production wedge: the cursor has accepted through 16, upload
 * sequence 17 no longer exists anywhere, and 18/19 sit held behind it.
 */
async function seedWedgedTerminal(
  t: ReturnType<typeof convexTest>,
  options: {
    gapAgeMs?: number;
    observationCount?: number;
    probeAgeMs?: number;
    reportsMissingSequence?: boolean;
    reportsBlockerKind?:
      | "awaiting_local_upload"
      | "awaiting_review"
      | "missing_locally";
  } = {},
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "owner@example.com",
    });
    const organizationId = await ctx.db.insert("organization", {
      name: "Test Org",
      slug: "test-org",
      createdByUserId: userId,
    });
    const storeId = await ctx.db.insert("store", {
      name: "Test Store",
      organizationId,
      slug: "test-store",
      currency: "GHS",
      createdByUserId: userId,
    });

    const terminalId = await ctx.db.insert("posTerminal", {
      storeId,
      displayName: "M Supplies",
      browserInfo: { userAgent: "test", platform: "test" },
      registerNumber: "1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "secret-1",
      status: "active",
      registeredAt: 1_000,
      registeredByUserId: userId,
    } as never);

    const staffProfileId = await ctx.db.insert("staffProfile", {
      storeId,
      organizationId,
      fullName: "Test Cashier",
      firstName: "Test",
      lastName: "Cashier",
      status: "active",
    });

    const now = Date.now();
    const cursorId = await ctx.db.insert("posLocalSyncCursor", {
      storeId,
      terminalId,
      syncScope: "pos",
      localSyncCursorId: CURSOR_ID,
      localRegisterSessionId: CURSOR_ID,
      acceptedThroughSequence: 16,
      updatedAt: now,
      gap: {
        missingFromSequence: 17,
        firstObservedAt:
          now - (options.gapAgeMs ?? SEQUENCE_GAP_PROBE_AFTER_MS + 60_000),
        lastObservedAt: now,
        observationCount: options.observationCount ?? 5,
        ...(options.probeAgeMs === undefined
          ? {}
          : { probeIssuedAt: now - options.probeAgeMs }),
      },
    });

    for (const sequence of [18, 19]) {
      await ctx.db.insert("posLocalSyncEvent", {
        storeId,
        terminalId,
        syncScope: "pos",
        localEventId: `event-${sequence}`,
        localRegisterSessionId: CURSOR_ID,
        sequence,
        eventType: "register_opened",
        occurredAt: now,
        staffProfileId,
        payload: { openingFloat: 100, registerNumber: "1" },
        status: "held",
        heldReason: "out_of_order",
        submittedAt: now,
      } as never);
    }

    if (options.reportsMissingSequence || options.reportsBlockerKind) {
      await ctx.db.insert("posTerminalRuntimeStatus", {
        storeId,
        terminalId,
        source: "sync-runtime",
        reportedAt: now,
        receivedAt: now,
        appShell: { observedAt: now, ready: true },
        localStore: { available: true, terminalSeedReady: true },
        snapshots: {},
        staffAuthority: { status: "ready" },
        sync: {
          status: "pending",
          pendingEventCount: 2,
          uploadableEventCount: 2,
          failedEventCount: 0,
          reviewEventCount: 0,
          localOnlyEventCount: 0,
          heldEventCount: 2,
          heldWithoutProgress: true,
          ...(options.reportsMissingSequence
            ? { heldBehindMissingUploadSequence: 17 }
            : {}),
          ...(options.reportsBlockerKind
            ? { heldBlockerKind: options.reportsBlockerKind }
            : {}),
        },
      } as never);
    }

    return { cursorId, storeId, terminalId };
  });
}

async function readCursor(
  t: ReturnType<typeof convexTest>,
  cursorId: Id<"posLocalSyncCursor">,
) {
  return await t.run(async (ctx) => ctx.db.get("posLocalSyncCursor", cursorId));
}

describe("POS upload-sequence gap reconciliation", () => {
  it("skips the burned sequence when the terminal reports it is gone", async () => {
    const t = convexTest(schema, modules);
    const { cursorId } = await seedWedgedTerminal(t, {
      reportsMissingSequence: true,
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      decision: "skip",
      detail: "terminal_reports_event_absent",
      skippedSequences: [17],
      // Both successors were freed and projected, not merely unblocked.
      reprojectedEventCount: 2,
    });

    // The wedge is gone: the cursor moved past the hole and the tracked gap
    // was cleared, so the held successors can project.
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(19);
    expect(cursor?.gap).toBeUndefined();
  });

  it("records a manager-visible conflict naming the skipped sequences", async () => {
    const t = convexTest(schema, modules);
    await seedWedgedTerminal(t, { reportsMissingSequence: true });

    await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    // Re-projecting the freed successors can raise its own conflicts; the
    // audit trail for the skip itself is the one asserted here.
    const allConflicts = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture
      ctx.db.query("posLocalSyncConflict").collect(),
    );
    const conflicts = allConflicts.filter(
      (conflict) => conflict.conflictType === "sequence_gap_skipped",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ status: "needs_review" });
    expect(conflicts[0]?.details).toMatchObject({
      skippedSequences: [17],
      previousAcceptedThroughSequence: 16,
      reason: "terminal_reports_event_absent",
    });
  });

  it("probes the terminal before skipping when it has said nothing", async () => {
    const t = convexTest(schema, modules);
    const { cursorId, terminalId } = await seedWedgedTerminal(t);

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes[0]).toMatchObject({
      decision: "probe",
      detail: "probe_issued",
    });

    // A cloud-issued probe carries no user id, and names the sequence so the
    // terminal can answer the specific question.
    const commands = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture
      ctx.db.query("posTerminalRecoveryCommand").collect(),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      commandType: "collect_local_review",
      terminalId,
      status: "pending",
    });
    expect(commands[0]?.issuedByUserId).toBeUndefined();
    expect(commands[0]?.commandContext.missingUploadSequence).toBe(17);

    // The cursor has not moved — probing never writes history.
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
    expect(cursor?.gap?.probeIssuedAt).toBeDefined();
  });

  it("leaves a freshly observed gap alone", async () => {
    const t = convexTest(schema, modules);
    const { cursorId } = await seedWedgedTerminal(t, {
      gapAgeMs: 1_000,
      observationCount: 1,
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes[0]).toMatchObject({ decision: "wait" });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
  });

  it("skips once a probe has gone unanswered past its window", async () => {
    const t = convexTest(schema, modules);
    const { cursorId } = await seedWedgedTerminal(t, {
      probeAgeMs: SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS + 60_000,
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes[0]).toMatchObject({
      decision: "skip",
      detail: "probe_unanswered",
    });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBeGreaterThanOrEqual(17);
  });


  it("never skips while the terminal says it still holds the event", async () => {
    // The M Supplies shape after the first fix: upload sequence 17 IS in the
    // local ledger, it just will not upload. Skipping would strand a real sale.
    const t = convexTest(schema, modules);
    const { cursorId } = await seedWedgedTerminal(t, {
      probeAgeMs: SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS * 10,
      reportsBlockerKind: "awaiting_local_upload",
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes[0]).toMatchObject({
      decision: "wait",
      detail: "terminal_has_event",
    });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
  });

  it("treats an empty review-item acknowledgement as no evidence", async () => {
    // `collect_local_review` enumerates review items only. A terminal with no
    // review items answers with an empty list, which must never be read as
    // proof the awaited sequence is gone.
    const t = convexTest(schema, modules);
    const { cursorId, storeId, terminalId } = await seedWedgedTerminal(t, {
      probeAgeMs: 60_000,
    });

    await t.run(async (ctx) => {
      const commandId = await ctx.db.insert("posTerminalRecoveryCommand", {
        storeId,
        terminalId,
        commandType: "collect_local_review",
        status: "completed",
        verificationStatus: "verified",
        commandContext: { missingUploadSequence: 17 },
        expectedEvidence: { localReviewDetailsCollected: true },
        issuedAt: Date.now(),
        expiresAt: Date.now() + 600_000,
        acknowledgement: {
          acknowledgedAt: Date.now(),
          result: "completed",
          localReviewEvents: [],
        },
      });
      const cursor = await ctx.db.get("posLocalSyncCursor", cursorId);
      await ctx.db.patch("posLocalSyncCursor", cursorId, {
        gap: { ...cursor!.gap!, probeCommandId: commandId },
      });
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.outcomes[0]).toMatchObject({
      decision: "wait",
      detail: "probe_in_flight",
    });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
  });


  it("persists gap evidence through the real runtime-status submit path", async () => {
    // Regression: the submit pipeline strips the sync object twice through
    // field whitelists (stripRuntimeStatusInput, then the command sanitizer).
    // Seeding the runtime-status row directly would bypass both and hide a
    // dropped field, so this test drives the real path — and then proves the
    // reconciler honors the terminal's "I still have it" past every timeout.
    const t = convexTest(schema, modules);
    const { cursorId, storeId, terminalId } = await seedWedgedTerminal(t, {
      probeAgeMs: SEQUENCE_GAP_SKIP_AFTER_UNANSWERED_MS * 10,
    });

    await t.run(async (ctx) => {
      const result = await submitTerminalRuntimeStatus(ctx, {
        storeId,
        terminalId,
        status: {
          reportedAt: Date.now(),
          source: "sync-runtime",
          appShell: { observedAt: Date.now(), ready: true },
          localStore: { available: true, terminalSeedReady: true },
          snapshots: {},
          staffAuthority: { status: "ready" },
          sync: {
            status: "pending",
            pendingEventCount: 3,
            uploadableEventCount: 3,
            failedEventCount: 0,
            reviewEventCount: 0,
            localOnlyEventCount: 0,
            heldEventCount: 2,
            heldWithoutProgress: true,
            heldBlockerKind: "awaiting_local_upload",
          },
        },
      });
      expect(result.kind).toBe("ok");
    });

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("posTerminalRuntimeStatus")
        .withIndex("by_store_terminal", (q) =>
          q.eq("storeId", storeId).eq("terminalId", terminalId),
        )
        .unique(),
    );
    expect(stored?.sync.heldBlockerKind).toBe("awaiting_local_upload");

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );
    expect(result.outcomes[0]).toMatchObject({
      decision: "wait",
      detail: "terminal_has_event",
    });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
  });

  it("writes nothing on a dry run", async () => {
    const t = convexTest(schema, modules);
    const { cursorId } = await seedWedgedTerminal(t, {
      reportsMissingSequence: true,
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      { dryRun: true },
    );

    expect(result.outcomes[0]).toMatchObject({
      decision: "skip",
      detail: "dry_run",
    });
    const cursor = await readCursor(t, cursorId);
    expect(cursor?.acceptedThroughSequence).toBe(16);
    expect(cursor?.gap).toBeDefined();

    const conflicts = await t.run(async (ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- test fixture
      ctx.db.query("posLocalSyncConflict").collect(),
    );
    expect(conflicts).toHaveLength(0);
  });

  it("ignores healthy cursors that have no gap", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "owner@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        name: "Test Org",
        slug: "test-org",
        createdByUserId: userId,
      });
      const storeId = await ctx.db.insert("store", {
        name: "Test Store",
        organizationId,
        slug: "test-store",
        currency: "GHS",
        createdByUserId: userId,
      });
      const terminalId = await ctx.db.insert("posTerminal", {
        storeId,
        displayName: "Healthy Terminal",
        browserInfo: { userAgent: "test", platform: "test" },
        registerNumber: "2",
        fingerprintHash: "fingerprint-2",
        syncSecretHash: "secret-2",
        status: "active",
        registeredAt: 1_000,
        registeredByUserId: userId,
      } as never);
      await ctx.db.insert("posLocalSyncCursor", {
        storeId,
        terminalId,
        syncScope: "pos",
        localSyncCursorId: CURSOR_ID,
        localRegisterSessionId: CURSOR_ID,
        acceptedThroughSequence: 42,
        updatedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.pos.application.sync.reconcileSequenceGaps
        .reconcilePosLocalSyncSequenceGaps,
      {},
    );

    expect(result.scannedCursorCount).toBe(0);
    expect(result.outcomes).toHaveLength(0);
  });
});
