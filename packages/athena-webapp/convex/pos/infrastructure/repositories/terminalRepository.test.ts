import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  getTerminalSyncEvidence,
  hasActiveRegisterSessionForTerminal,
  resolveTerminalRegisterSessionActionTarget,
  TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
  TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP,
  upsertLatestRuntimeStatus,
  upsertLatestRuntimeStatusWithOutcome,
} from "./terminalRepository";

describe("terminalRepository runtime status", () => {
  it("patches the existing latest runtime status for a terminal", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          _id: "other-store-status" as Id<"posTerminalRuntimeStatus">,
          storeId: "store-2" as Id<"store">,
        }),
        buildRuntimeStatus({
          _id: "other-terminal-status" as Id<"posTerminalRuntimeStatus">,
          terminalId: "terminal-2" as Id<"posTerminal">,
        }),
        buildRuntimeStatus(),
      ],
    });
    const input = {
      ...buildRuntimeStatus(),
      localStore: {
        available: true,
        schemaVersion: 2,
        terminalSeedReady: true,
      },
      reportedAt: 250,
      receivedAt: 260,
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-1");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      "runtime-status-1",
      input,
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("patches app-session recovery as undefined so stale recovery status clears", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appSessionRecovery: {
            status: "blocked_terminal",
          },
        }),
      ],
    });
    const input = {
      ...buildRuntimeStatus(),
      appSessionRecovery: undefined,
      reportedAt: 300,
      receivedAt: 310,
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-1");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      "runtime-status-1",
      expect.objectContaining({
        appSessionRecovery: undefined,
      }),
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("preserves last-known app-update evidence when a newer runtime report omits it", async () => {
    const appUpdate = {
      canApply: true,
      currentBuildId: "build-current",
      detectorStatus: "ok",
      observedAt: 200,
      pendingBuildId: "build-next",
      stagingStatus: "unstaged",
      status: "update_ready_unstaged",
    } as const;
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appUpdate,
          reportedAt: 200,
          receivedAt: 210,
        }),
      ],
    });
    const input = {
      ...buildRuntimeStatus(),
      appUpdate: undefined,
      reportedAt: 250,
      receivedAt: 30_260,
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-1");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      "runtime-status-1",
      expect.objectContaining({
        appUpdate,
        reportedAt: 250,
        receivedAt: 30_260,
      }),
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("coalesces fast duplicate runtime status reports without patching", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
    });
    const input = {
      ...buildRuntimeStatus(),
      reportedAt: 250,
      receivedAt: 260,
      snapshots: {
        catalogAgeMs: 1500,
        serviceCatalogAgeMs: 1500,
      },
      sync: {
        ...buildRuntimeStatus().sync,
        lastTrigger: "interval",
      },
    };

    const result = await upsertLatestRuntimeStatusWithOutcome(
      ctx as never,
      input,
    );

    expect(result).toEqual({
      didWrite: false,
      runtimeStatusId: "runtime-status-1",
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("refreshes duplicate runtime status after the server heartbeat window", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
    });
    const input = {
      ...buildRuntimeStatus(),
      reportedAt: 30_000,
      receivedAt: 30_000,
    };

    const result = await upsertLatestRuntimeStatusWithOutcome(
      ctx as never,
      input,
    );

    expect(result).toEqual({
      didWrite: true,
      runtimeStatusId: "runtime-status-1",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      "runtime-status-1",
      input,
    );
  });

  it("ignores delayed older runtime status reports for the latest row", async () => {
    const ctx = buildCtx({
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appSessionRecovery: undefined,
          reportedAt: 300,
          receivedAt: 310,
        }),
      ],
    });
    const input = {
      ...buildRuntimeStatus({
        appSessionRecovery: {
          status: "retrying",
        },
        reportedAt: 250,
        receivedAt: 320,
      }),
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-1");
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("inserts runtime status when no status exists for the terminal", async () => {
    const ctx = buildCtx();
    const input = buildRuntimeStatus();

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-new");
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "posTerminalRuntimeStatus",
      input,
    );
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("omits undefined app-session recovery on first runtime status insert", async () => {
    const ctx = buildCtx();
    const input = {
      ...buildRuntimeStatus(),
      appSessionRecovery: undefined,
    };

    const result = await upsertLatestRuntimeStatus(ctx as never, input);

    expect(result).toBe("runtime-status-new");
    const insertedPayload = ctx.db.insert.mock.calls[0]?.[1];
    expect(insertedPayload).not.toHaveProperty("appSessionRecovery");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe("terminalRepository sync evidence", () => {
  it("returns cursor evidence when no recent events exist", async () => {
    const ctx = buildCtx({
      posLocalSyncCursor: [
        {
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          _creationTime: 1,
          acceptedThroughSequence: 12,
          localRegisterSessionId: "register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          updatedAt: 300,
        },
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual({
      latestEvent: null,
      latestReviewEvent: null,
      latestReviewEventsByStatus: {
        conflicted: null,
        held: null,
        rejected: null,
      },
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
      reviewSummary: {
        groups: [],
        meta: {
          cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
          hasMore: false,
          sampledCount: 0,
          targetResolutionIncomplete: false,
        },
      },
      acceptedThroughSequence: 12,
      cursorUpdatedAt: 300,
    });
  });

  it("aggregates recent sync event statuses and latest event evidence", async () => {
    const ctx = buildCtx({
      posLocalSyncCursor: [
        {
          _id: "cursor-1" as Id<"posLocalSyncCursor">,
          _creationTime: 1,
          acceptedThroughSequence: 7,
          localRegisterSessionId: "register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
          updatedAt: 400,
        },
      ],
      posLocalSyncEvent: [
        buildSyncEvent({
          localEventId: "event-accepted",
          sequence: 1,
          status: "accepted",
        }),
        buildSyncEvent({
          localEventId: "event-projected",
          sequence: 2,
          status: "projected",
        }),
        buildSyncEvent({
          localEventId: "event-conflicted",
          sequence: 3,
          status: "conflicted",
        }),
        buildSyncEvent({
          localEventId: "event-held",
          sequence: 4,
          status: "held",
        }),
        buildSyncEvent({
          localEventId: "event-rejected",
          sequence: 5,
          status: "rejected",
        }),
      ],
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-older" as Id<"posLocalSyncConflict">,
          localEventId: "event-conflicted",
          sequence: 3,
          summary: "Older conflict.",
        }),
        buildSyncConflict({
          _id: "conflict-latest" as Id<"posLocalSyncConflict">,
          localEventId: "event-rejected",
          sequence: 5,
          summary: "A register session is already open for this terminal.",
        }),
        buildSyncConflict({
          _id: "conflict-other-terminal" as Id<"posLocalSyncConflict">,
          localEventId: "event-other",
          sequence: 6,
          summary: "Other terminal conflict.",
          terminalId: "terminal-2" as Id<"posTerminal">,
        }),
        buildSyncConflict({
          _id: "conflict-resolved" as Id<"posLocalSyncConflict">,
          localEventId: "event-resolved",
          sequence: 7,
          status: "resolved",
          summary: "Resolved conflict.",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual({
      latestEvent: expect.objectContaining({
        localEventId: "event-rejected",
        sequence: 5,
        status: "rejected",
      }),
      latestReviewEvent: expect.objectContaining({
        localEventId: "event-rejected",
        sequence: 5,
        status: "rejected",
      }),
      latestReviewEventsByStatus: {
        conflicted: expect.objectContaining({
          localEventId: "event-conflicted",
          sequence: 3,
          status: "conflicted",
        }),
        held: expect.objectContaining({
          localEventId: "event-held",
          sequence: 4,
          status: "held",
        }),
        rejected: expect.objectContaining({
          localEventId: "event-rejected",
          sequence: 5,
          status: "rejected",
        }),
      },
      sampledEventCount: 5,
      acceptedCount: 1,
      projectedCount: 1,
      conflictedCount: 1,
      heldCount: 1,
      rejectedCount: 1,
      unresolvedConflictCount: 2,
      unresolvedConflicts: [
        expect.objectContaining({
          _id: "conflict-latest",
          localEventId: "event-rejected",
          sequence: 5,
          summary: "A synced register event needs permission review.",
        }),
        expect.objectContaining({
          _id: "conflict-older",
          localEventId: "event-conflicted",
          sequence: 3,
          summary: "A synced register event needs permission review.",
        }),
      ],
      acceptedThroughSequence: 7,
      cursorUpdatedAt: 400,
      reviewSummary: {
        groups: [
          expect.objectContaining({
            actionability: "manual_review",
            conflictType: "permission",
            count: 2,
            owner: "manual_review",
          }),
        ],
        meta: {
          cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
          hasMore: false,
          sampledCount: 2,
          targetResolutionIncomplete: false,
        },
      },
    });
  });

  it("groups inventory conflicts with open work targets under operations", async () => {
    const ctx = buildCtx({
      operationalWorkItem: [
        buildOperationalWorkItem({
          _id: "work-item-1" as Id<"operationalWorkItem">,
          metadata: {
            localEventId: "event-inventory",
          },
          status: "open",
          type: "synced_sale_inventory_review",
        }),
      ],
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-inventory" as Id<"posLocalSyncConflict">,
          conflictType: "inventory",
          localEventId: "event-inventory",
          sequence: 9,
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflicts?.[0]).toMatchObject({
      _id: "conflict-inventory",
      reviewTarget: {
        type: "open_work",
        workItemId: "work-item-1",
        workItemType: "synced_sale_inventory_review",
      },
    });
    expect(result.reviewSummary).toEqual({
      groups: [
        expect.objectContaining({
          actionability: "open_work_review",
          conflictType: "inventory",
          count: 1,
          owner: "operations_open_work",
          reviewTarget: {
            type: "open_work",
            workItemId: "work-item-1",
            workItemType: "synced_sale_inventory_review",
          },
        }),
      ],
      meta: {
        cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
        hasMore: false,
        sampledCount: 1,
        targetResolutionIncomplete: false,
      },
    });
  });

  it("groups mapped register-session conflicts under cash controls", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-register" as Id<"posLocalSyncConflict">,
          conflictType: "permission",
          localRegisterSessionId: "local-register-1",
          sequence: 8,
        }),
      ],
      posLocalSyncMapping: [
        buildSyncMapping({
          cloudId: "register-session-1",
          localId: "local-register-1",
          localRegisterSessionId: "local-register-1",
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-session-1" as Id<"registerSession">,
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        actionTarget: {
          registerSessionId: "register-session-1",
          type: "register_session",
        },
        actionability: "cash_controls_review",
        conflictType: "permission",
        count: 1,
        owner: "cash_controls",
      }),
    ]);
  });

  it("omits mapped conflicts for settled register sessions from current review evidence", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-closed-register" as Id<"posLocalSyncConflict">,
          conflictType: "permission",
          localRegisterSessionId: "local-register-closed",
          sequence: 8,
        }),
      ],
      posLocalSyncMapping: [
        buildSyncMapping({
          cloudId: "register-session-closed",
          localId: "local-register-closed",
          localRegisterSessionId: "local-register-closed",
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-session-closed" as Id<"registerSession">,
          closedAt: 900,
          countedCash: 100,
          status: "closed",
          variance: 0,
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflictCount).toBe(0);
    expect(result.unresolvedConflicts).toEqual([]);
    expect(result.reviewSummary).toEqual({
      groups: [],
      meta: {
        cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
        hasMore: false,
        sampledCount: 0,
        targetResolutionIncomplete: false,
      },
    });
  });

  it("omits register conflicts when the blocking register session is already settled", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-closed-blocking-session" as Id<"posLocalSyncConflict">,
          conflictType: "permission",
          details: {
            blockingRegisterSessionId: "register-session-closed",
            localRegisterSessionId: "local-register-new",
            registerNumber: "1",
          },
          localRegisterSessionId: "local-register-new",
          sequence: 8,
          summary: "A register session is already open for this terminal.",
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-session-closed" as Id<"registerSession">,
          closedAt: 900,
          countedCash: 100,
          status: "closed",
          variance: 0,
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflictCount).toBe(0);
    expect(result.unresolvedConflicts).toEqual([]);
    expect(result.reviewSummary?.groups).toEqual([]);
  });

  it("dedupes repeated register conflicts for the same local event", async () => {
    const duplicateConflicts = Array.from({ length: 4 }, (_, index) =>
      buildSyncConflict({
        _id: `conflict-duplicate-${index}` as Id<"posLocalSyncConflict">,
        conflictType: "permission",
        details: {
          blockingRegisterSessionId: "register-session-open",
          localRegisterSessionId: "local-register-new",
          registerNumber: "1",
        },
        localEventId: "event-register-open",
        localRegisterSessionId: "local-register-new",
        sequence: 8,
        summary: "A register session is already open for this terminal.",
      }),
    );
    const ctx = buildCtx({
      posLocalSyncConflict: duplicateConflicts,
      registerSession: [
        buildRegisterSession({
          _id: "register-session-open" as Id<"registerSession">,
          status: "open",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflictCount).toBe(1);
    expect(result.unresolvedConflicts).toHaveLength(1);
    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        actionTarget: {
          registerSessionId: "register-session-open",
          type: "register_session",
        },
        actionability: "cash_controls_review",
        conflictType: "permission",
        count: 1,
        owner: "cash_controls",
      }),
    ]);
  });

  it("finds actionable inventory conflicts behind newer settled register conflicts", async () => {
    const settledRegisterConflicts = Array.from(
      { length: 5_010 },
      (_, index) =>
        buildSyncConflict({
          _id: `conflict-settled-${index}` as Id<"posLocalSyncConflict">,
          conflictType: "permission",
          details: {
            blockingRegisterSessionId: "register-session-closed",
            localRegisterSessionId: `local-register-${index}`,
            registerNumber: "1",
          },
          localEventId: `event-register-open-${index}`,
          localRegisterSessionId: `local-register-${index}`,
          sequence: 1_000 + index,
          summary: "A register session is already open for this terminal.",
        }),
    );
    const ctx = buildCtx({
      posLocalSyncConflict: [
        ...settledRegisterConflicts,
        buildSyncConflict({
          _id: "conflict-inventory" as Id<"posLocalSyncConflict">,
          conflictType: "inventory",
          details: {
            localTransactionId: "local-transaction-1",
            productSkuId: "sku-1",
            quantityAvailable: 0,
            requestedQuantity: 1,
          },
          localEventId: "event-inventory",
          sequence: 8,
          summary: "Inventory needs manager review for a synced offline sale.",
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-session-closed" as Id<"registerSession">,
          closedAt: 900,
          countedCash: 100,
          status: "closed",
          variance: 0,
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflicts).toEqual([
      expect.objectContaining({
        _id: "conflict-inventory",
        conflictType: "inventory",
        localEventId: "event-inventory",
      }),
    ]);
    expect(result.reviewSummary?.meta).toMatchObject({
      hasMore: true,
      sampledCount: 1,
      targetResolutionIncomplete: true,
    });
    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        actionability: "manual_review",
        conflictType: "inventory",
        count: 1,
        owner: "manual_review",
      }),
    ]);
  });

  it("caps review summary samples and reports when more conflicts exist", async () => {
    const conflicts = Array.from(
      { length: TERMINAL_SYNC_REVIEW_SUMMARY_CAP + 1 },
      (_, index) =>
        buildSyncConflict({
          _id: `conflict-${index}` as Id<"posLocalSyncConflict">,
          localEventId: `event-${index}`,
          sequence: index + 1,
        }),
    );
    const ctx = buildCtx({
      posLocalSyncConflict: conflicts,
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflicts).toHaveLength(20);
    expect(result.reviewSummary?.meta).toEqual({
      cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      hasMore: true,
      sampledCount: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      targetResolutionIncomplete: true,
    });
    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        count: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      }),
    ]);
  });

  it("marks target resolution incomplete when open work lookup is capped before a match", async () => {
    const workItems = Array.from(
      { length: TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP + 1 },
      (_, index) =>
        buildOperationalWorkItem({
          _id: `work-item-${index}` as Id<"operationalWorkItem">,
          metadata: {
            localEventId:
              index === TERMINAL_SYNC_REVIEW_TARGET_LOOKUP_CAP
                ? "event-inventory"
                : `other-event-${index}`,
          },
          status: "open",
          type: "synced_sale_inventory_review",
        }),
    );
    const ctx = buildCtx({
      operationalWorkItem: workItems,
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-inventory" as Id<"posLocalSyncConflict">,
          conflictType: "inventory",
          localEventId: "event-inventory",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflicts?.[0]?.reviewTarget).toBeUndefined();
    expect(result.reviewSummary?.meta).toEqual({
      cap: TERMINAL_SYNC_REVIEW_SUMMARY_CAP,
      hasMore: false,
      sampledCount: 1,
      targetResolutionIncomplete: true,
    });
    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        actionability: "diagnostic_only",
        conflictType: "inventory",
        owner: "diagnostic",
      }),
    ]);
  });

  it("finds matching open work targets after closed inventory review history", async () => {
    const closedWorkItems = Array.from({ length: 8 }, (_, index) =>
      buildOperationalWorkItem({
        _id: `closed-work-item-${index}` as Id<"operationalWorkItem">,
        metadata: {
          localEventId: `closed-event-${index}`,
        },
        status: "completed",
        type: "synced_sale_inventory_review",
      }),
    );
    const ctx = buildCtx({
      operationalWorkItem: [
        ...closedWorkItems,
        buildOperationalWorkItem({
          _id: "work-item-current" as Id<"operationalWorkItem">,
          metadata: {
            localEventId: "event-inventory",
          },
          status: "open",
          type: "synced_sale_inventory_review",
        }),
      ],
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-inventory" as Id<"posLocalSyncConflict">,
          conflictType: "inventory",
          localEventId: "event-inventory",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.unresolvedConflicts?.[0]?.reviewTarget).toEqual({
      type: "open_work",
      workItemId: "work-item-current",
      workItemType: "synced_sale_inventory_review",
    });
    expect(result.reviewSummary?.meta.targetResolutionIncomplete).toBe(false);
  });

  it("keeps business-fact conflicts in manual review without exposing raw details", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [
        buildSyncConflict({
          _id: "conflict-payment" as Id<"posLocalSyncConflict">,
          conflictType: "payment",
          details: {
            accountNumber: "4111111111111111",
            customerName: "Sensitive Customer",
            staffProofToken: "staff-proof-secret",
          },
          summary: "Payment projection requires manager review.",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result.reviewSummary?.groups).toEqual([
      expect.objectContaining({
        actionability: "manual_review",
        conflictType: "payment",
        count: 1,
        owner: "manual_review",
      }),
    ]);
    expect(JSON.stringify(result.reviewSummary)).not.toContain(
      "4111111111111111",
    );
    expect(JSON.stringify(result.reviewSummary)).not.toContain(
      "Sensitive Customer",
    );
    expect(JSON.stringify(result.reviewSummary)).not.toContain(
      "staff-proof-secret",
    );
    expect(result.unresolvedConflicts?.[0]?.summary).toBe(
      "A synced register event needs review.",
    );
  });

  it("excludes manager-rejected sync reviews from actionable terminal evidence", async () => {
    const ctx = buildCtx({
      posLocalSyncEvent: [
        buildSyncEvent({
          localEventId: "event-manager-rejected",
          rejectionCode: "manager_rejected",
          sequence: 6,
          status: "rejected",
        }),
        buildSyncEvent({
          localEventId: "event-rejected",
          sequence: 5,
          status: "rejected",
        }),
        buildSyncEvent({
          localEventId: "event-projected",
          sequence: 4,
          status: "projected",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toMatchObject({
      latestEvent: expect.objectContaining({
        localEventId: "event-manager-rejected",
        status: "rejected",
      }),
      latestReviewEvent: expect.objectContaining({
        localEventId: "event-rejected",
        status: "rejected",
      }),
      latestReviewEventsByStatus: {
        conflicted: null,
        held: null,
        rejected: expect.objectContaining({
          localEventId: "event-rejected",
          status: "rejected",
        }),
      },
      rejectedCount: 1,
    });
  });

  it("does not report terminal review evidence for fully manager-rejected sync history", async () => {
    const ctx = buildCtx({
      posLocalSyncEvent: [
        buildSyncEvent({
          localEventId: "event-manager-rejected",
          rejectionCode: "manager_rejected",
          sequence: 6,
          status: "rejected",
        }),
        buildSyncEvent({
          localEventId: "event-projected",
          sequence: 4,
          status: "projected",
        }),
      ],
    });

    const result = await getTerminalSyncEvidence(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toMatchObject({
      latestReviewEvent: null,
      latestReviewEventsByStatus: {
        conflicted: null,
        held: null,
        rejected: null,
      },
      rejectedCount: 0,
    });
  });
});

describe("terminalRepository active register-session evidence", () => {
  it("finds an active register session directly linked to the terminal", async () => {
    const ctx = buildCtx({
      registerSession: [
        buildRegisterSession({
          status: "open",
        }),
      ],
    });

    await expect(
      hasActiveRegisterSessionForTerminal(ctx as never, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBe(true);
  });

  it("finds an older active register session when newer terminal history is closed", async () => {
    const ctx = buildCtx({
      registerSession: [
        buildRegisterSession({
          _creationTime: 30,
          registerNumber: "8",
          status: "closed",
          terminalId: "terminal-1" as Id<"posTerminal">,
        }),
        buildRegisterSession({
          _creationTime: 20,
          registerNumber: "8",
          status: "active",
          terminalId: "terminal-1" as Id<"posTerminal">,
        }),
      ],
    });

    await expect(
      hasActiveRegisterSessionForTerminal(ctx as never, {
        registerNumber: "8",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBe(true);
  });

  it("falls back to latest register-number evidence when the terminal latest session is closed", async () => {
    const ctx = buildCtx({
      registerSession: [
        buildRegisterSession({
          _creationTime: 30,
          registerNumber: "7",
          status: "closed",
          terminalId: "terminal-1" as Id<"posTerminal">,
        }),
        buildRegisterSession({
          _creationTime: 20,
          registerNumber: "8",
          status: "active",
          terminalId: "terminal-1" as Id<"posTerminal">,
        }),
      ],
    });

    await expect(
      hasActiveRegisterSessionForTerminal(ctx as never, {
        registerNumber: "7",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBe(false);
    await expect(
      hasActiveRegisterSessionForTerminal(ctx as never, {
        registerNumber: "8",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBe(true);
  });
});

describe("terminalRepository register-session action targets", () => {
  it("resolves a local register session to its cloud register session mapping", async () => {
    const ctx = buildCtx({
      posLocalSyncMapping: [
        {
          _id: "mapping-1" as Id<"posLocalSyncMapping">,
          _creationTime: 1,
          cloudId: "register-session-1",
          cloudTable: "registerSession",
          createdAt: 1,
          localEventId: "event-1",
          localId: "local-register-1",
          localIdKind: "registerSession",
          localRegisterSessionId: "local-register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
        },
      ],
      registerSession: [
        {
          _id: "register-session-1" as Id<"registerSession">,
          _creationTime: 1,
          expectedCash: 100,
          openedAt: 1,
          openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
          openingFloat: 100,
          registerNumber: "1",
          status: "open",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
        },
      ],
    });

    await expect(
      resolveTerminalRegisterSessionActionTarget(ctx as never, {
        localRegisterSessionId: "local-register-1",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBe("register-session-1");
  });

  it("does not resolve register session mappings for another terminal", async () => {
    const ctx = buildCtx({
      posLocalSyncMapping: [
        {
          _id: "mapping-1" as Id<"posLocalSyncMapping">,
          _creationTime: 1,
          cloudId: "register-session-1",
          cloudTable: "registerSession",
          createdAt: 1,
          localEventId: "event-1",
          localId: "local-register-1",
          localIdKind: "registerSession",
          localRegisterSessionId: "local-register-1",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-1" as Id<"posTerminal">,
        },
      ],
      registerSession: [
        {
          _id: "register-session-1" as Id<"registerSession">,
          _creationTime: 1,
          expectedCash: 100,
          openedAt: 1,
          openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
          openingFloat: 100,
          registerNumber: "1",
          status: "closed",
          storeId: "store-1" as Id<"store">,
          terminalId: "terminal-2" as Id<"posTerminal">,
        },
      ],
    });

    await expect(
      resolveTerminalRegisterSessionActionTarget(ctx as never, {
        localRegisterSessionId: "local-register-1",
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
      }),
    ).resolves.toBeNull();
  });
});

function buildCtx(
  seed: {
    operationalWorkItem?: Array<Doc<"operationalWorkItem">>;
    posLocalSyncCursor?: Array<Doc<"posLocalSyncCursor">>;
    posLocalSyncConflict?: Array<Doc<"posLocalSyncConflict">>;
    posLocalSyncEvent?: Array<Doc<"posLocalSyncEvent">>;
    posLocalSyncMapping?: Array<Doc<"posLocalSyncMapping">>;
    posTerminalRuntimeStatus?: Array<Doc<"posTerminalRuntimeStatus">>;
    registerSession?: Array<Doc<"registerSession">>;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (tableName: keyof typeof seed, id: string) => {
        return (
          ((seed[tableName] ?? []) as Array<Record<string, unknown>>).find(
            (row) => row._id === id,
          ) ?? null
        );
      }),
      insert: vi.fn(
        async (_tableName: string, _value: Record<string, unknown>) =>
          "runtime-status-new",
      ),
      patch: vi.fn(async () => undefined),
      query: vi.fn((tableName: keyof typeof seed) =>
        buildQuery((seed[tableName] ?? []) as Array<Record<string, unknown>>),
      ),
    },
  };
}

function buildQuery<T extends { _creationTime?: number; sequence?: number }>(
  rows: T[],
) {
  let currentRows = [...rows];
  return {
    withIndex: vi.fn(
      (
        _indexName: string,
        build: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        const q = {
          eq: vi.fn((field: string, value: unknown) => {
            currentRows = currentRows.filter(
              (row) => (row as Record<string, unknown>)[field] === value,
            );
            return q;
          }),
        };
        build(q);

        return {
          order: vi.fn((direction: "asc" | "desc") => {
            currentRows = [...currentRows].sort((left, right) => {
              const leftOrder = left.sequence ?? left._creationTime ?? 0;
              const rightOrder = right.sequence ?? right._creationTime ?? 0;
              return direction === "desc"
                ? rightOrder - leftOrder
                : leftOrder - rightOrder;
            });
            return {
              first: vi.fn(async () => currentRows[0] ?? null),
              take: vi.fn(async (count: number) => currentRows.slice(0, count)),
            };
          }),
          take: vi.fn(async (count: number) => currentRows.slice(0, count)),
          unique: vi.fn(async () => currentRows[0] ?? null),
        };
      },
    ),
  };
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: 100,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    reportedAt: 100,
    receivedAt: 110,
    source: "sync-runtime",
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    sync: {
      status: "idle",
      pendingEventCount: 0,
      uploadableEventCount: 0,
      failedEventCount: 0,
      reviewEventCount: 0,
      localOnlyEventCount: 0,
    },
    staffAuthority: {
      status: "unknown",
    },
    snapshots: {},
    ...overrides,
  };
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _id: "register-session-1" as Id<"registerSession">,
    _creationTime: 1,
    expectedCash: 100,
    openedAt: 1,
    openedByStaffProfileId: "staff-1" as Id<"staffProfile">,
    openingFloat: 100,
    registerNumber: "1",
    status: "open",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  };
}

function buildSyncEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: `${overrides.localEventId ?? "event-1"}-id` as Id<"posLocalSyncEvent">,
    _creationTime: overrides.sequence ?? 1,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "sale.completed",
    sequence: 1,
    status: "accepted",
    occurredAt: 100,
    submittedAt: 110,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}

function buildSyncMapping(
  overrides: Partial<Doc<"posLocalSyncMapping">> = {},
): Doc<"posLocalSyncMapping"> {
  return {
    _id: "mapping-1" as Id<"posLocalSyncMapping">,
    _creationTime: 1,
    cloudId: "register-session-1",
    cloudTable: "registerSession",
    createdAt: 1,
    localEventId: "event-1",
    localId: "local-register-1",
    localIdKind: "registerSession",
    localRegisterSessionId: "local-register-1",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  } as Doc<"posLocalSyncMapping">;
}

function buildSyncConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: overrides.sequence ?? 1,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    sequence: 1,
    conflictType: "permission",
    status: "needs_review",
    summary: "Register session mapping is missing for synced POS history.",
    details: {},
    createdAt: 120,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildOperationalWorkItem(
  overrides: Partial<Doc<"operationalWorkItem">> = {},
): Doc<"operationalWorkItem"> {
  return {
    _id: "work-item-1" as Id<"operationalWorkItem">,
    _creationTime: 1,
    approvalState: "not_required",
    createdAt: 1,
    metadata: {},
    organizationId: "organization-1" as Id<"organization">,
    priority: "normal",
    status: "open",
    storeId: "store-1" as Id<"store">,
    title: "Review synced sale inventory",
    type: "synced_sale_inventory_review",
    ...overrides,
  } as Doc<"operationalWorkItem">;
}
