import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY } from "../../../../shared/registerSessionLifecyclePolicy";
import {
  getTerminalHealthSummary,
  listTerminalHealthSummaries,
} from "./terminals";

const now = 2_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("terminal health queries", () => {
  it("treats a closed cloud drawer authority as ready for the next drawer", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          drawerAuthority: {
            cloudRegisterSessionId: "register-1",
            localRegisterSessionId: "local-register-1",
            observedAt: now - 2_000,
            reason: "cloud_closed",
            status: "blocked",
          },
          saleAuthority: {
            observedAt: now - 1_000,
            status: "ready",
            transactionMode: "products_and_services",
          },
        }),
      ],
      registerSession: [
        buildRegisterSession({
          _id: "register-1" as Id<"registerSession">,
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.health).toBe("online");
    expect(summary?.runtimeStatus?.drawerAuthority).toBeUndefined();
    expect(summary?.attentionReasons.map((reason) => reason.type)).not.toContain(
      "drawer_authority_blocked",
    );
    expect(summary?.recoveryPreview?.readiness).toBe("healthy_idle");
    expect(summary?.recoveryPreview?.terminalActions).toEqual([]);
  });

  it.each(["closing", "closeout_rejected"] as const)(
    "treats a %s cloud drawer authority as ready for replacement",
    async (status) => {
      const ctx = buildQueryCtx({
        posTerminal: [buildTerminal()],
        posTerminalRuntimeStatus: [
          buildRuntimeStatus({
            drawerAuthority: {
              cloudRegisterSessionId: "register-1",
              localRegisterSessionId: "local-register-1",
              observedAt: now - 2_000,
              reason: "cloud_closed",
              status: "blocked",
            },
            saleAuthority: {
              observedAt: now - 1_000,
              status: "ready",
              transactionMode: "products_and_services",
            },
          }),
        ],
        registerSession: [
          buildRegisterSession({
            _id: "register-1" as Id<"registerSession">,
            closeoutRecords: [],
            closedAt: undefined,
            status,
          }),
        ],
      });

      const summary = await getTerminalHealthSummary(ctx, {
        now,
        storeId,
        terminalId,
      });

      expect(summary?.health).toBe("online");
      expect(summary?.runtimeStatus?.drawerAuthority).toBeUndefined();
      expect(summary?.attentionReasons.map((reason) => reason.type)).not.toContain(
        "drawer_authority_blocked",
      );
      expect(summary?.recoveryPreview?.readiness).toBe("healthy_idle");
      expect(summary?.recoveryPreview?.terminalActions).toEqual([]);
    },
  );

  it("includes latest terminal recovery command lifecycle metadata in the health preview", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [
        {
          _id: terminalId,
          _creationTime: now - 50_000,
          browserInfo: {
            userAgent: "Mozilla/5.0",
          },
          displayName: "Front register",
          fingerprintHash: "fingerprint",
          registeredAt: now - 50_000,
          registeredByUserId: "user-1" as Id<"athenaUser">,
          status: "active",
          storeId,
        } satisfies Doc<"posTerminal">,
      ],
      posTerminalRuntimeStatus: [
        {
          _id: "runtime-1" as Id<"posTerminalRuntimeStatus">,
          _creationTime: now - 2_000,
          appSessionRecovery: {
            status: "ready",
          },
          browserInfo: {
            online: true,
            userAgent: "Mozilla/5.0",
          },
          localStore: {
            available: true,
            terminalSeedReady: true,
          },
          receivedAt: now - 1_000,
          reportedAt: now - 1_000,
          snapshots: {},
          source: "sync-runtime",
          staffAuthority: {
            status: "ready",
          },
          storeId,
          sync: {
            failedEventCount: 0,
            localOnlyEventCount: 0,
            pendingEventCount: 0,
            reviewEventCount: 0,
            status: "idle",
            uploadableEventCount: 0,
          },
          terminalId,
          terminalIntegrity: {
            observedAt: now - 1_000,
            status: "healthy",
          },
        } satisfies Doc<"posTerminalRuntimeStatus">,
      ],
      posTerminalRecoveryCommand: [
        {
          _id: "command-old" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 20_000,
          commandContext: {
            reason: "Old sync retry.",
          },
          commandType: "retry_sync",
          expectedEvidence: {
            syncStatus: "idle",
          },
          expiresAt: now + 5_000,
          issuedAt: now - 20_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "completed",
          storeId,
          terminalId,
          verificationStatus: "verified",
        } satisfies Doc<"posTerminalRecoveryCommand">,
        {
          _id: "command-latest" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 5_000,
          acknowledgement: {
            acknowledgedAt: now - 4_000,
            message: "Terminal setup repair completed locally.",
            result: "completed",
          },
          commandContext: {
            expectedBlockerType: "terminal_seed",
            reason: "Terminal setup data needs repair.",
          },
          commandType: "repair_terminal_seed",
          expectedEvidence: {
            terminalIntegrityStatus: "healthy",
          },
          expiresAt: now + 5_000,
          issuedAt: now - 5_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "completed",
          storeId,
          terminalId,
          verificationStatus: "runtime_verification_ready",
        } satisfies Doc<"posTerminalRecoveryCommand">,
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.commandStatus).toEqual({
      commandId: "command-latest",
      commandType: "repair_terminal_seed",
      label: "Terminal setup repair",
      latestAcknowledgement: "Terminal setup repair completed locally.",
      status: "completed",
      verificationStatus: "runtime_verification_ready",
    });
  });

  it("projects stale pending recovery commands as expired in the health preview", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRecoveryCommand: [
        {
          _id: "command-expired" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 20_000,
          commandContext: {
            reason: "Terminal setup data needs repair.",
          },
          commandType: "repair_terminal_seed",
          expectedEvidence: {
            terminalIntegrityStatus: "healthy",
          },
          expiresAt: now - 1,
          issuedAt: now - 20_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "pending",
          storeId,
          terminalId,
          verificationStatus: "waiting_for_acknowledgement",
        } satisfies Doc<"posTerminalRecoveryCommand">,
      ],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.commandStatus).toEqual(
      expect.objectContaining({
        commandId: "command-expired",
        status: "expired",
      }),
    );
  });

  it("keeps expired staff authority out of support recovery actions", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          staffAuthority: {
            status: "expired",
          },
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.readiness).toBe("healthy_idle");
    expect(summary?.recoveryPreview?.terminalActions).toEqual([]);
  });

  it("derives app update status from fresh runtime evidence", async () => {
    for (const [runtimeStatus, expectedStatus] of [
      ["current", "current"],
      ["update_ready", "update_ready"],
      ["blocked", "blocked"],
      ["detector_failed", "detector_failed"],
    ] as const) {
      const ctx = buildQueryCtx({
        posTerminal: [buildTerminal()],
        posTerminalRuntimeStatus: [
          buildRuntimeStatus({
            appUpdate: {
              canApply: runtimeStatus === "update_ready",
              currentBuildId: "build-current",
              detectorStatus: "ok",
              observedAt: now - 1_000,
              pendingBuildId: "build-next",
              selectedBlockerCode:
                runtimeStatus === "blocked" ? "active_sale" : undefined,
              stagingStatus:
                runtimeStatus === "update_ready" ? "staged" : "unknown",
              status: runtimeStatus,
            },
          }),
        ],
      });

      const summary = await getTerminalHealthSummary(ctx, {
        now,
        storeId,
        terminalId,
      });

      expect(summary?.recoveryPreview?.appUpdate).toEqual(
        expect.objectContaining({
          currentBuildId: "build-current",
          evidenceFresh: true,
          pendingBuildId: "build-next",
          status: expectedStatus,
        }),
      );
      expect(summary?.recoveryPreview?.terminalActions).toEqual([]);
    }
  });

  it("keeps unstaged app-update cache evidence refreshable when runtime can apply", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appUpdate: {
            canApply: true,
            currentBuildId: "build-current",
            detectorStatus: "ok",
            observedAt: now - 1_000,
            pendingBuildId: "build-next",
            stagingAssetCount: 17,
            stagingFailedAssetCount: 1,
            stagingReason: "asset-staging-failed",
            stagingRejectedAssetCount: 0,
            stagingStatus: "unstaged",
            status: "update_ready",
          },
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.appUpdate).toEqual(
      expect.objectContaining({
        evidenceFresh: true,
        pendingBuildId: "build-next",
        stagingStatus: "unstaged",
        status: "update_ready",
        summary:
          "An app update is ready, but the POS app shell could not cache every required asset for offline use. 1 of 17 asset needs attention.",
      }),
    );
  });

  it("treats missing and stale app update evidence as unknown or stale", async () => {
    const missingCtx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
    });
    const missingSummary = await getTerminalHealthSummary(missingCtx, {
      now,
      storeId,
      terminalId,
    });

    expect(missingSummary?.recoveryPreview?.appUpdate).toEqual({
      evidenceFresh: false,
      status: "unknown",
    });

    const staleCtx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appUpdate: {
            canApply: true,
            currentBuildId: "build-current",
            detectorStatus: "ok",
            observedAt: now - 10 * 60_000,
            pendingBuildId: "build-next",
            stagingStatus: "staged",
            status: "update_ready",
          },
          receivedAt: now - 10 * 60_000,
        }),
      ],
    });
    const staleSummary = await getTerminalHealthSummary(staleCtx, {
      now,
      storeId,
      terminalId,
    });

    expect(staleSummary?.recoveryPreview?.appUpdate).toEqual(
      expect.objectContaining({
        evidenceFresh: false,
        status: "stale",
      }),
    );
  });

  it("does not treat replayed stale app update evidence as command-correlated", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRecoveryCommand: [
        {
          _id: "command-update" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 5_000,
          commandContext: {
            expectedBlockerType: "app_update",
            reason: "Support requested an app update check.",
          },
          commandType: "update_app",
          expectedEvidence: {
            appUpdateStatus: "current",
          },
          expiresAt: now + 10_000,
          issuedAt: now - 5_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "completed",
          storeId,
          terminalId,
          verificationStatus: "runtime_verification_ready",
        } as unknown as Doc<"posTerminalRecoveryCommand">,
      ],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appUpdate: {
            canApply: false,
            commandExecutionId: "older-command",
            commandIssuedAt: now - 20_000,
            currentBuildId: "build-current",
            detectorStatus: "ok",
            observedAt: now - 10 * 60_000,
            stagingStatus: "unknown",
            status: "current",
          },
          receivedAt: now - 10 * 60_000,
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.commandStatus).toEqual(
      expect.objectContaining({
        commandType: "update_app",
        verificationStatus: "runtime_verification_ready",
      }),
    );
    expect(summary?.recoveryPreview?.appUpdate).toEqual(
      expect.objectContaining({
        commandCorrelated: false,
        evidenceFresh: false,
        status: "stale",
      }),
    );
  });

  it("marks fresh flat app update commandExecutionId evidence as command-correlated", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRecoveryCommand: [
        {
          _id: "command-update" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 5_000,
          commandContext: {
            expectedBlockerType: "app_update",
            reason: "Support requested an app update check.",
          },
          commandType: "update_app",
          expectedEvidence: {
            appUpdateCommandExecutionId: "execution-1",
          },
          expiresAt: now + 10_000,
          issuedAt: now - 5_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "completed",
          storeId,
          terminalId,
          verificationStatus: "runtime_verification_ready",
        } as unknown as Doc<"posTerminalRecoveryCommand">,
      ],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          appUpdate: {
            canApply: false,
            commandExecutionId: "execution-1",
            commandIssuedAt: now - 5_000,
            currentBuildId: "build-current",
            detectorStatus: "ok",
            observedAt: now - 1_000,
            stagingStatus: "unknown",
            status: "current",
          },
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.appUpdate).toEqual(
      expect.objectContaining({
        commandCorrelated: true,
        evidenceFresh: true,
        status: "current",
      }),
    );
  });

  it("includes recovery preview on terminal health roster summaries", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
    });

    const summaries = await listTerminalHealthSummaries(ctx, {
      now,
      storeId,
    });

    expect(summaries[0]?.recoveryPreview).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          activeRegisterSession: false,
        }),
        readiness: "healthy_idle",
      }),
    );
  });

  it("offers cloud repair preview for a replacement open after submitted closeout review", async () => {
    const duplicateOpenConflict = buildConflict({
      _id: "duplicate-open-conflict" as Id<"posLocalSyncConflict">,
      localEventId: "event-open-replacement",
      localRegisterSessionId: "register-replacement",
      sequence: 3,
    });
    const closeoutVarianceConflict = buildConflict({
      _id: "closeout-conflict" as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        countedCash: 95,
        expectedCash: 100,
        variance: -5,
      },
      localEventId: "event-register-closed",
      localRegisterSessionId: "register-prior",
      sequence: 2,
      summary: REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
    });
    const ctx = buildQueryCtx({
      posLocalSyncConflict: [closeoutVarianceConflict, duplicateOpenConflict],
      posLocalSyncEvent: [
        buildEvent({
          _id: "event-open-replacement-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-replacement",
          localRegisterSessionId: "register-replacement",
          sequence: 3,
        }),
      ],
      posTerminal: [buildTerminal({ registerNumber: "A1" })],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-prior" as Id<"registerSession">,
          closedAt: undefined,
          registerNumber: "A1",
          status: "closing",
        }),
      ],
      staffProfile: [buildStaffProfile()],
      staffRoleAssignment: [buildStaffRoleAssignment()],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.cloudRepair.safeConflictIds).toEqual([
      duplicateOpenConflict._id,
    ]);
    expect(summary?.recoveryPreview?.cloudRepair.skippedConflictIds).toEqual([
      closeoutVarianceConflict._id,
    ]);
  });

  it("does not offer cloud repair preview for duplicate open blocked by an active drawer", async () => {
    const duplicateOpenConflict = buildConflict({
      _id: "duplicate-active-open-conflict" as Id<"posLocalSyncConflict">,
      localEventId: "event-open-replacement",
      localRegisterSessionId: "register-replacement",
      sequence: 2,
    });
    const ctx = buildQueryCtx({
      posLocalSyncConflict: [duplicateOpenConflict],
      posLocalSyncEvent: [
        buildEvent({
          _id: "event-open-replacement-id" as Id<"posLocalSyncEvent">,
          localEventId: "event-open-replacement",
          localRegisterSessionId: "register-replacement",
          sequence: 2,
        }),
      ],
      posTerminal: [buildTerminal({ registerNumber: "A1" })],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-active" as Id<"registerSession">,
          closedAt: undefined,
          registerNumber: "A1",
          status: "active",
        }),
      ],
      staffProfile: [buildStaffProfile()],
      staffRoleAssignment: [buildStaffRoleAssignment()],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.cloudRepair.safeConflictIds).toEqual([]);
    expect(summary?.recoveryPreview?.cloudRepair.skippedConflictIds).toEqual([
      duplicateOpenConflict._id,
    ]);
  });

  it("keeps terminal health roster and detail recovery preview in parity", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRecoveryCommand: [
        {
          _id: "command-retry-sync" as Id<"posTerminalRecoveryCommand">,
          _creationTime: now - 5_000,
          commandContext: {
            expectedBlockerType: "sync_runtime",
            reason: "Local sync needs a terminal retry.",
          },
          commandType: "retry_sync",
          expectedEvidence: {
            syncStatus: "idle",
          },
          expiresAt: now + 10_000,
          issuedAt: now - 5_000,
          issuedByUserId: "user-1" as Id<"athenaUser">,
          status: "pending",
          storeId,
          terminalId,
          verificationStatus: "waiting_for_acknowledgement",
        } satisfies Doc<"posTerminalRecoveryCommand">,
      ],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          sync: {
            failedEventCount: 1,
            lastFailureMessage: "Network unavailable.",
            localOnlyEventCount: 0,
            nextPendingUploadSequence: 45,
            oldestPendingEventAt: now - 30_000,
            pendingEventCount: 1,
            reviewEventCount: 0,
            status: "failed",
            uploadableEventCount: 1,
          },
        }),
      ],
    });

    const [rosterSummary] = await listTerminalHealthSummaries(ctx, {
      now,
      storeId,
    });
    const detailSummary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(rosterSummary?.attentionReasons).toEqual([
      expect.objectContaining({
        nextPendingUploadSequence: 45,
        source: "local_runtime",
        type: "sync_failed",
      }),
    ]);
    expect(rosterSummary?.recoveryPreview).toEqual(detailSummary?.recoveryPreview);
    expect(rosterSummary?.recoveryPreview).toEqual(
      expect.objectContaining({
        commandStatus: expect.objectContaining({
          commandType: "retry_sync",
          status: "pending",
          verificationStatus: "waiting_for_acknowledgement",
        }),
        readiness: "needs_terminal_action",
        terminalActions: [
          expect.objectContaining({
            commandType: "retry_sync",
            expectedEvidence: {
              syncStatus: "idle",
            },
          }),
        ],
      }),
    );
  });

  it("includes active register-session evidence in recovery preview", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          status: "open",
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.evidence).toEqual(
      expect.objectContaining({
        activeRegisterSession: true,
      }),
    );
    expect(summary?.recoveryPreview?.readiness).toBe("drawer_open");
  });

  it("requires an active register session before reporting able to transact now", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          saleAuthority: {
            observedAt: now - 1_000,
            status: "ready",
            transactionMode: "products_and_services",
          },
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.evidence).toEqual(
      expect.objectContaining({
        activeRegisterSession: false,
      }),
    );
    expect(summary?.recoveryPreview?.readiness).toBe("healthy_idle");
  });

  it("reports able to transact now when the drawer is open and sale authority is ready", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          saleAuthority: {
            observedAt: now - 1_000,
            status: "ready",
            transactionMode: "products_and_services",
          },
        }),
      ],
      registerSession: [
        buildRegisterSession({
          status: "active",
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.evidence).toEqual(
      expect.objectContaining({
        activeRegisterSession: true,
      }),
    );
    expect(summary?.recoveryPreview?.readiness).toBe("able_to_transact_now");
  });

  it("uses runtime active drawer evidence for recovery readiness", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [
        buildRuntimeStatus({
          activeRegisterSession: {
            localRegisterSessionId: "local-register-1",
            observedAt: now - 1_000,
            openedAt: now - 20_000,
            registerNumber: "8",
            status: "open",
          },
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.recoveryPreview?.evidence).toEqual(
      expect.objectContaining({
        activeRegisterSession: true,
      }),
    );
    expect(summary?.recoveryPreview?.readiness).toBe("drawer_open");
  });

  it("links terminal cards to the active register session for the terminal", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [
        buildTerminal({
          registerNumber: "8",
        }),
      ],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-closed-latest" as Id<"registerSession">,
          closedAt: now - 1_000,
          openedAt: now - 20_000,
          registerNumber: "8",
          status: "closed",
        }),
        buildRegisterSession({
          _id: "register-open" as Id<"registerSession">,
          closeoutRecords: [],
          closedAt: undefined,
          openedAt: now - 100_000,
          registerNumber: "8",
          status: "open",
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.registerSessionLink).toEqual({
      registerSessionId: "register-open",
      status: "open",
    });
  });

  it("does not link terminal cards to closed register sessions", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [buildTerminal()],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-closed-older" as Id<"registerSession">,
          closedAt: now - 30_000,
        }),
        buildRegisterSession({
          _id: "register-closed-newer" as Id<"registerSession">,
          closedAt: now - 1_000,
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.registerSessionLink).toBeNull();
  });

  it("does not link register-number matches that are not bound to the terminal", async () => {
    const ctx = buildQueryCtx({
      posTerminal: [
        buildTerminal({
          registerNumber: "8",
        }),
      ],
      posTerminalRuntimeStatus: [buildRuntimeStatus()],
      registerSession: [
        buildRegisterSession({
          _id: "register-open-other-terminal" as Id<"registerSession">,
          closeoutRecords: [],
          closedAt: undefined,
          registerNumber: "8",
          status: "open",
          terminalId: undefined,
        }),
      ],
    });

    const summary = await getTerminalHealthSummary(ctx, {
      now,
      storeId,
      terminalId,
    });

    expect(summary?.registerSessionLink).toBeNull();
  });
});

type TestTable =
  | "posLocalSyncConflict"
  | "posLocalSyncCursor"
  | "posLocalSyncEvent"
  | "posLocalSyncMapping"
  | "posTerminal"
  | "posTerminalRecoveryCommand"
  | "posTerminalRuntimeStatus"
  | "registerSession"
  | "staffProfile"
  | "staffRoleAssignment";

function buildQueryCtx(
  records: Partial<Record<TestTable, Array<Record<string, unknown>>>>,
) {
  return {
    db: {
      get(table: TestTable, id: string) {
        return Promise.resolve(
          records[table]?.find((record) => record._id === id) ?? null,
        );
      },
      normalizeId(table: TestTable, id: string) {
        return records[table]?.some((record) => record._id === id) ? id : null;
      },
      query(table: TestTable) {
        return buildQuery(records[table] ?? []);
      },
    },
  } as unknown as QueryCtx;
}

function buildTerminal(
  overrides: Partial<Doc<"posTerminal">> = {},
): Doc<"posTerminal"> {
  return {
    _id: terminalId,
    _creationTime: now - 50_000,
    browserInfo: {
      userAgent: "Mozilla/5.0",
    },
    displayName: "Front register",
    fingerprintHash: "fingerprint",
    registeredAt: now - 50_000,
    registeredByUserId: "user-1" as Id<"athenaUser">,
    status: "active",
    storeId,
    ...overrides,
  };
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: now - 2_000,
    appSessionRecovery: {
      status: "ready",
    },
    browserInfo: {
      online: true,
      userAgent: "Mozilla/5.0",
    },
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    receivedAt: now - 1_000,
    reportedAt: now - 1_000,
    snapshots: {},
    source: "sync-runtime",
    staffAuthority: {
      status: "ready",
    },
    storeId,
    sync: {
      failedEventCount: 0,
      localOnlyEventCount: 0,
      pendingEventCount: 0,
      reviewEventCount: 0,
      status: "idle",
      uploadableEventCount: 0,
    },
    terminalId,
    terminalIntegrity: {
      observedAt: now - 1_000,
      status: "healthy",
    },
    ...overrides,
  };
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _id: "register-1" as Id<"registerSession">,
    _creationTime: now - 10_000,
    closeoutRecords: [
      {
        expectedCash: 0,
        occurredAt: now - 5_000,
        type: "closed",
      },
    ],
    closedAt: now - 5_000,
    expectedCash: 0,
    openedAt: now - 100_000,
    openingFloat: 0,
    status: "closed",
    storeId,
    terminalId,
    ...overrides,
  };
}

function buildStaffProfile(
  overrides: Partial<Doc<"staffProfile">> = {},
): Doc<"staffProfile"> {
  return {
    _id: "staff-1" as Id<"staffProfile">,
    _creationTime: now - 50_000,
    status: "active",
    storeId,
    ...overrides,
  } as Doc<"staffProfile">;
}

function buildStaffRoleAssignment(overrides: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _creationTime: now - 50_000,
    role: "cashier",
    staffProfileId: "staff-1",
    status: "active",
    storeId,
    ...overrides,
  };
}

function buildConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: now - 20 * 60 * 1000,
    conflictType: "duplicate_local_id",
    createdAt: now - 20 * 60 * 1000,
    details: { reason: "duplicate_register_opened" },
    localEventId: "event-1",
    localRegisterSessionId: "register-1",
    sequence: 1,
    status: "needs_review",
    storeId,
    summary: "Duplicate register-open attempt for an already opened drawer.",
    terminalId,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1-id" as Id<"posLocalSyncEvent">,
    _creationTime: now - 20 * 60 * 1000,
    eventType: "register_opened",
    localEventId: "event-1",
    localRegisterSessionId: "register-1",
    occurredAt: now - 20 * 60 * 1000,
    payload: {
      openingFloat: 100,
      registerNumber: "A1",
    },
    sequence: 1,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    status: "conflicted",
    storeId,
    submittedAt: now - 19 * 60 * 1000,
    terminalId,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}

function buildQuery(records: Array<Record<string, unknown>>) {
  const chain = {
    collect: () => Promise.resolve(records),
    first: () => Promise.resolve(records[0] ?? null),
    order: () => chain,
    take: (count: number) => Promise.resolve(records.slice(0, count)),
    unique: () => Promise.resolve(records[0] ?? null),
    withIndex: () => chain,
  };

  return chain;
}
