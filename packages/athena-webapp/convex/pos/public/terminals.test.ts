import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledgeTerminalRecoveryCommandService: vi.fn(),
  claimTerminalRecoveryCommandService: vi.fn(),
  createTerminalRecoveryCommandReadRepository: vi.fn(),
  createTerminalRecoveryCommandRepository: vi.fn(),
  deleteTerminalCommand: vi.fn(),
  getTerminalHealthSummaryQuery: vi.fn(),
  getTerminalByFingerprintQuery: vi.fn(),
  getLatestRuntimeStatusForTerminal: vi.fn(),
  issueTerminalRecoveryCommandService: vi.fn(),
  listClaimableTerminalRecoveryCommands: vi.fn(),
  listTerminalHealthSummariesQuery: vi.fn(),
  listTerminalsQuery: vi.fn(),
  previewTerminalRecoveryQuery: vi.fn(),
  registerTerminalCommand: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  resolveTerminalCloudRepairCommand: vi.fn(),
  createRemoteAssistRepository: vi.fn(),
  remoteAssistGetClientByRuntime: vi.fn(),
  remoteAssistGetCurrentSessionForClient: vi.fn(),
  remoteAssistGetSession: vi.fn(),
  remoteAssistInsertEvent: vi.fn(),
  remoteAssistPatchSession: vi.fn(),
  remoteAssistUpsertClient: vi.fn(),
  submitTerminalRuntimeStatusCommand: vi.fn(),
  updateTerminalCommand: vi.fn(),
  verifyTerminalRecoveryCommandsFromRuntime: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/commands/terminals", () => ({
  deleteTerminal: mocks.deleteTerminalCommand,
  registerTerminal: mocks.registerTerminalCommand,
  submitTerminalRuntimeStatus: mocks.submitTerminalRuntimeStatusCommand,
  updateTerminal: mocks.updateTerminalCommand,
}));

vi.mock("../application/queries/terminals", () => ({
  getTerminalByFingerprint: mocks.getTerminalByFingerprintQuery,
  getTerminalHealthSummary: mocks.getTerminalHealthSummaryQuery,
  listTerminalHealthSummaries: mocks.listTerminalHealthSummariesQuery,
  listTerminals: mocks.listTerminalsQuery,
  previewTerminalRecovery: mocks.previewTerminalRecoveryQuery,
}));

vi.mock("../application/terminalRecovery/resolveTerminalCloudRepair", () => ({
  resolveTerminalCloudRepair: mocks.resolveTerminalCloudRepairCommand,
}));

vi.mock("../application/terminalRecovery/terminalCommandService", () => ({
  acknowledgeTerminalRecoveryCommand:
    mocks.acknowledgeTerminalRecoveryCommandService,
  claimTerminalRecoveryCommand: mocks.claimTerminalRecoveryCommandService,
  issueTerminalRecoveryCommand: mocks.issueTerminalRecoveryCommandService,
  listClaimableTerminalRecoveryCommands:
    mocks.listClaimableTerminalRecoveryCommands,
  verifyTerminalRecoveryCommandsFromRuntime:
    mocks.verifyTerminalRecoveryCommandsFromRuntime,
}));

vi.mock("../infrastructure/repositories/terminalRecoveryRepository", () => ({
  createTerminalRecoveryCommandReadRepository:
    mocks.createTerminalRecoveryCommandReadRepository,
  createTerminalRecoveryCommandRepository:
    mocks.createTerminalRecoveryCommandRepository,
}));

vi.mock("../infrastructure/repositories/terminalRepository", () => ({
  getLatestRuntimeStatusForTerminal: mocks.getLatestRuntimeStatusForTerminal,
}));

vi.mock("../../remoteAssist/infrastructure/remoteAssistRepository", () => ({
  createRemoteAssistRepository: mocks.createRemoteAssistRepository,
}));

import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import {
  deleteTerminal,
  getTerminalByFingerprint,
  getTerminalHealthSummary,
  getRuntimeRemoteAssistSession,
  issueTerminalRecoveryCommand,
  listTerminalRecoveryCommands,
  listTerminalHealthSummaries,
  listTerminals,
  previewTerminalRecovery,
  claimTerminalRecoveryCommand,
  acknowledgeTerminalRecoveryCommand,
  disconnectRemoteAssistSession,
  registerTerminal,
  resolveTerminalCloudRepair,
  submitTerminalRuntimeStatus,
  updateTerminal,
} from "./terminals";

const SYNC_SECRET_HASH =
  "e3aaef72556405db4093f59a9aa8ee6539f8e6542e60d92f08e782faa0d246fa";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function buildTerminalHealthSummaryResult() {
  return {
    terminal: {
      _id: "terminal-1",
      displayName: "Front register",
      registerNumber: "1",
      registeredByUserId: "athena-user-1",
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
    },
    health: "online",
    runtimeAgeMs: 1_000,
    runtimeStatus: null,
    attentionReasons: [
      {
        source: "terminal_runtime",
        summary: "Terminal setup data needs repair.",
        type: "terminal_seed_missing",
        actionTarget: {
          type: "pos_settings",
        },
      },
    ],
    operationalExplanation: {
      blockingDomain: "terminal_runtime",
      detail: "The terminal needs a local repair command before support can continue.",
      evidenceReferences: [
        {
          count: 1,
          source: "terminal_runtime",
          summary: "Terminal setup data needs repair.",
          type: "terminal_seed_missing",
        },
      ],
      headline: "Terminal action needed",
      lane: "needs_terminal_action",
      nextStep: "Send the available terminal repair command.",
      primaryOwner: "terminal",
      saleImpact: "not_ready",
      secondaryActions: [
        {
          label: "Safe cloud repair available",
          primaryOwner: "support",
          supportAction: "safe_cloud_repair",
        },
      ],
      severity: "warning",
      summaryMeta: {
        hasSecondarySafeRepair: true,
        reviewBacklogCount: 0,
        targetResolutionIncomplete: false,
      },
      supportAction: "terminal_command",
    },
    recoveryPreview: {
      readiness: "needs_terminal_action",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      appUpdate: {
        commandCorrelated: true,
        currentBuildId: "build-current",
        evidenceFresh: true,
        observedAt: 100,
        pendingBuildId: "build-next",
        status: "update_ready_unstaged",
        summary: "An app update is available but not ready to refresh yet.",
      },
      cloudRepair: {
        preconditionHash: "terminal-cloud-repair:hash",
        safeConflictIds: ["conflict-1"],
        skippedConflictIds: [],
      },
      commandStatus: {
        appUpdateCommandExecutionId: "execution-1",
        commandId: "command-1",
        commandType: "update_app",
        label: "Update app",
        latestAcknowledgement: "Update app evaluated.",
        status: "completed",
        verificationStatus: "runtime_verification_ready",
      },
      terminalActions: [
        {
          commandType: "update_app",
          expectedEvidence: {
            appUpdateCommandExecutionId: "execution-1",
            appUpdateStatus: "update_ready_unstaged",
          },
          commandContext: {
            expectedBlockerType: "app_update",
            reason: "Support requested an app update check.",
          },
          reason: "Ask the checkout station to report app update readiness.",
        },
      ],
      manualReview: [
        {
          reason: "Unsafe cloud conflict needs manual review.",
          source: "cloud_repair",
          type: "unsafe_cloud_conflict",
        },
      ],
    },
    registerSessionLink: {
      registerSessionId: "register-session-1",
      status: "open",
    },
    syncEvidence: {
      latestEvent: {
        localEventId: "event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 7,
        eventType: "sale_completed",
        status: "accepted",
        occurredAt: 90,
        submittedAt: 95,
        acceptedAt: 100,
        projectedAt: 105,
      },
      latestReviewEvent: {
        localEventId: "event-review",
        localRegisterSessionId: "local-register-1",
        sequence: 8,
        eventType: "sale_completed",
        status: "conflicted",
      },
      latestReviewEventsByStatus: {
        conflicted: {
          localEventId: "event-conflicted",
          localRegisterSessionId: "local-register-1",
          sequence: 8,
          eventType: "sale_completed",
          status: "conflicted",
        },
        held: null,
        rejected: null,
      },
      sampledEventCount: 2,
      acceptedCount: 1,
      projectedCount: 1,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 1,
      unresolvedConflicts: [
        {
          _id: "conflict-1",
          conflictType: "duplicate_local_id",
          createdAt: 100,
          localEventId: "event-conflicted",
          localRegisterSessionId: "local-register-1",
          sequence: 8,
          summary: "Duplicate local event id.",
        },
      ],
      reviewSummary: {
        groups: [
          {
            actionability: "manual_review",
            conflictType: "duplicate_local_id",
            count: 1,
            latestCreatedAt: 100,
            latestSequence: 8,
            owner: "manual_review",
          },
        ],
        meta: {
          sampledCount: 1,
          cap: 50,
          hasMore: false,
          targetResolutionIncomplete: false,
        },
      },
      acceptedThroughSequence: 7,
      cursorUpdatedAt: 110,
    },
  };
}

function buildRemoteAssistClient(overrides: Record<string, unknown> = {}) {
  return {
    _creationTime: 1,
    _id: "remote-client-1",
    accessPolicy: "unattended_allowed",
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    createdAt: 1,
    displayName: "Front register",
    enrollmentStatus: "active",
    lastPresenceAt: 200,
    organizationId: "org-1",
    presenceStatus: "online",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    storeId: "store-1",
    updatedAt: 200,
    ...overrides,
  };
}

function buildRemoteAssistSession(overrides: Record<string, unknown> = {}) {
  return {
    _creationTime: 1,
    _id: "remote-session-1",
    clientId: "remote-client-1",
    effectiveMode: "unattended",
    expiresAt: 10_000,
    organizationId: "org-1",
    reason: "Drawer repair support",
    requestedAt: 100,
    requestedByUserId: "athena-user-1",
    requestedMode: "unattended",
    sensitiveModeActive: false,
    status: "connecting",
    storeId: "store-1",
    transportProvider: "livekit",
    ...overrides,
  };
}

describe("POS terminal public mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.registerTerminalCommand.mockResolvedValue({
      kind: "ok",
      data: {
        _id: "terminal-1",
        _creationTime: 1,
        storeId: "store-1",
        fingerprintHash: "fingerprint-1",
        syncSecretHash: "sync-secret-1",
        displayName: "Front register",
        registeredByUserId: "athena-user-1",
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active",
      },
    });
    mocks.deleteTerminalCommand.mockResolvedValue(null);
    mocks.updateTerminalCommand.mockResolvedValue({
      _id: "terminal-1",
      _creationTime: 1,
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registeredByUserId: "athena-user-1",
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
    });
    mocks.listTerminalsQuery.mockResolvedValue([]);
    mocks.getTerminalByFingerprintQuery.mockResolvedValue(null);
    mocks.listTerminalHealthSummariesQuery.mockResolvedValue([]);
    mocks.getTerminalHealthSummaryQuery.mockResolvedValue(null);
    mocks.getLatestRuntimeStatusForTerminal.mockResolvedValue(null);
    mocks.previewTerminalRecoveryQuery.mockResolvedValue({
      appUpdate: {
        description: "Current",
        status: "current",
      },
      readiness: "needs_terminal_action",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: [],
        skippedConflictIds: [],
      },
      commandStatus: null,
      terminalActions: [
        {
          commandType: "repair_terminal_seed",
          commandContext: {
            expectedBlockerType: "terminal_seed",
            reason: "Terminal setup data needs repair.",
          },
          expectedEvidence: {
            terminalIntegrityStatus: "healthy",
          },
          reason: "Terminal setup data needs repair.",
        },
      ],
      manualReview: [],
    });
    mocks.createTerminalRecoveryCommandReadRepository.mockReturnValue({
      repository: "read",
    });
    mocks.createTerminalRecoveryCommandRepository.mockReturnValue({
      repository: "write",
    });
    mocks.createRemoteAssistRepository.mockReturnValue({
      getClientByRuntime: mocks.remoteAssistGetClientByRuntime,
      getCurrentSessionForClient: mocks.remoteAssistGetCurrentSessionForClient,
      getSession: mocks.remoteAssistGetSession,
      insertEvent: mocks.remoteAssistInsertEvent,
      patchSession: mocks.remoteAssistPatchSession,
      upsertClient: mocks.remoteAssistUpsertClient,
    });
    mocks.remoteAssistUpsertClient.mockResolvedValue(buildRemoteAssistClient());
    mocks.remoteAssistGetClientByRuntime.mockResolvedValue(
      buildRemoteAssistClient(),
    );
    mocks.remoteAssistGetCurrentSessionForClient.mockResolvedValue(null);
    mocks.remoteAssistGetSession.mockResolvedValue(null);
    mocks.issueTerminalRecoveryCommandService.mockResolvedValue({
      kind: "ok",
      data: buildRecoveryCommand(),
    });
    mocks.listClaimableTerminalRecoveryCommands.mockResolvedValue([
      buildRecoveryCommand(),
    ]);
    mocks.claimTerminalRecoveryCommandService.mockResolvedValue({
      kind: "ok",
      data: buildRecoveryCommand({ status: "claimed" }),
    });
    mocks.acknowledgeTerminalRecoveryCommandService.mockResolvedValue({
      kind: "ok",
      data: buildRecoveryCommand({ status: "completed" }),
    });
    mocks.resolveTerminalCloudRepairCommand.mockResolvedValue({
      kind: "ok",
      data: {
        preconditionHash: "terminal-cloud-repair:hash",
        resolvedConflictIds: ["conflict-1"],
        skippedConflictIds: [],
      },
    });
    mocks.submitTerminalRuntimeStatusCommand.mockResolvedValue({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
  });

  it("derives terminal ownership from the signed-in user and allows POS store membership", async () => {
    const ctx = buildCtx();

    await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.registerTerminalCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        registeredByUserId: "athena-user-1",
      }),
    );
  });

  it("does not register a terminal when store membership is missing", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to register this POS terminal.",
      },
    });
    expect(mocks.registerTerminalCommand).not.toHaveBeenCalled();
  });

  it("requires full admin membership before deleting a terminal", async () => {
    const ctx = buildCtx();

    await getHandler(deleteTerminal)(ctx as never, {
      terminalId: "terminal-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.deleteTerminalCommand).toHaveBeenCalledWith(ctx, {
      terminalId: "terminal-1",
    });
  });

  it("does not delete a terminal when full admin membership is missing", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(deleteTerminal)(ctx as never, { terminalId: "terminal-1" }),
    ).rejects.toThrow("denied");
    expect(mocks.deleteTerminalCommand).not.toHaveBeenCalled();
  });

  it("requires full admin membership before updating a terminal", async () => {
    const ctx = buildCtx();

    const result = await getHandler(updateTerminal)(ctx as never, {
      terminalId: "terminal-1",
      displayName: "Updated terminal",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.updateTerminalCommand).toHaveBeenCalledWith(ctx, {
      terminalId: "terminal-1",
      displayName: "Updated terminal",
    });
    expect(result).toEqual(
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    );
  });

  it("requires store membership before listing terminals", async () => {
    mocks.listTerminalsQuery.mockResolvedValue([
      {
        _id: "terminal-1",
        _creationTime: 1,
        storeId: "store-1",
        fingerprintHash: "fingerprint-1",
        syncSecretHash: "sync-secret-1",
        displayName: "Front register",
        registeredByUserId: "athena-user-1",
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active",
      },
    ]);
    const ctx = buildCtx();

    const result = await getHandler(listTerminals)(ctx as never, {
      storeId: "store-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.listTerminalsQuery).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
    expect(result).toEqual([
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    ]);
  });

  it("requires store membership before looking up terminals by fingerprint", async () => {
    mocks.getTerminalByFingerprintQuery.mockResolvedValue({
      _id: "terminal-1",
      _creationTime: 1,
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registeredByUserId: "athena-user-1",
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
    });
    const ctx = buildCtx();

    const result = await getHandler(getTerminalByFingerprint)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getTerminalByFingerprintQuery).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
    });
    expect(result).toEqual(
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    );
  });

  it("returns the sync secret only from terminal registration", async () => {
    const ctx = buildCtx();

    const result = await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        syncSecretHash: "sync-secret-1",
      }),
    });
    expect(mocks.registerTerminalCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        syncSecretHash: SYNC_SECRET_HASH,
      }),
    );
  });

  it("accepts redacted runtime status from active terminal proof without Athena user auth", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus({
        drawerAuthority: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 112,
          reason: "cloud_closed",
          status: "blocked",
        },
        sync: {
          ...buildRuntimeStatus().sync,
          reviewEventCount: 1,
          reviewEvents: [
            {
              createdAt: 101,
              localEventId: "event-review-1",
              localRegisterSessionId: "local-register-1",
              localTransactionId: "transaction-local-1",
              sequence: 9,
              staffProfileId: "staff-1",
              status: "needs_review",
              type: "transaction.completed",
              uploaded: true,
              uploadSequence: 9,
            },
          ],
          status: "needs_review",
        },
        staffProofToken: "proof-token",
        terminalIntegrity: {
          observedAt: 111,
          reason: "authorization_failed",
          status: "requires_reprovision",
        },
        verifierMetadata: { salt: "never" },
        rawLocalEvents: [{ payload: { customerInfo: { phone: "never" } } }],
      }),
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        trustedTerminal: expect.objectContaining({
          _id: "terminal-1",
          storeId: "store-1",
          status: "active",
        }),
        status: expect.objectContaining({
          drawerAuthority: {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
            observedAt: 112,
            reason: "cloud_closed",
            status: "blocked",
          },
          sync: expect.objectContaining({
            reviewEvents: [
              expect.objectContaining({
                localEventId: "event-review-1",
                localRegisterSessionId: "local-register-1",
                status: "needs_review",
              }),
            ],
          }),
          terminalIntegrity: {
            observedAt: 111,
            reason: "authorization_failed",
            status: "requires_reprovision",
          },
        }),
      }),
    );
    expect(
      mocks.submitTerminalRuntimeStatusCommand.mock.calls[0]?.[1].status,
    ).not.toEqual(
      expect.objectContaining({
        staffProofToken: expect.anything(),
        verifierMetadata: expect.anything(),
        rawLocalEvents: expect.anything(),
      }),
    );
    const forwardedStatus =
      mocks.submitTerminalRuntimeStatusCommand.mock.calls[0]?.[1].status;
    expect(JSON.stringify(forwardedStatus.sync.reviewEvents)).not.toMatch(
      /transaction-local-1|staff-1/,
    );
  });

  it("enrolls Remote Assist presence after a successful runtime check-in", async () => {
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
        displayName: "Front register",
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus({
        browserInfo: {
          language: "en-GB",
          online: true,
          platform: "macOS",
          userAgent: "Athena POS",
        },
      }),
    });

    expect(mocks.remoteAssistUpsertClient).toHaveBeenCalledWith(
      expect.objectContaining({
        accessPolicy: "unattended_allowed",
        adapterRef: {
          id: "terminal-1",
          kind: "pos_terminal",
          label: "Front register",
        },
        browserSummary: {
          online: "true",
          platform: "macOS",
        },
        displayName: "Front register",
        enrollmentStatus: "active",
        organizationId: "org-1",
        presenceStatus: "online",
        runtimeIdentity: "terminal-1",
        runtimeType: "pos_terminal",
        storeId: "store-1",
      }),
    );
  });

  it("skips runtime side effects when the backend coalesces a fast duplicate check-in", async () => {
    mocks.submitTerminalRuntimeStatusCommand.mockResolvedValue({
      kind: "ok",
      data: {
        acceptedForSideEffects: false,
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
        displayName: "Front register",
      },
    });

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    expect(mocks.remoteAssistUpsertClient).not.toHaveBeenCalled();
    expect(
      mocks.verifyTerminalRecoveryCommandsFromRuntime,
    ).not.toHaveBeenCalled();
  });

  it("claims a connecting Remote Assist session after a successful runtime check-in", async () => {
    const session = buildRemoteAssistSession({ status: "connecting" });
    mocks.remoteAssistGetCurrentSessionForClient.mockResolvedValue(session);
    mocks.remoteAssistGetSession.mockResolvedValue(session);
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
        displayName: "Front register",
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(mocks.remoteAssistGetCurrentSessionForClient).toHaveBeenCalledWith({
      clientId: "remote-client-1",
      now: 200,
    });
    expect(mocks.remoteAssistPatchSession).toHaveBeenCalledWith(
      "remote-session-1",
      {
        startedAt: 200,
        status: "active",
      },
    );
    expect(mocks.remoteAssistInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "remote-client-1",
        eventType: "runtime_claimed",
        occurredAt: 200,
        participantRole: "runtime",
        sessionId: "remote-session-1",
      }),
    );
  });

  it("keeps accepted runtime status accepted when Remote Assist presence fails", async () => {
    const diagnosticSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mocks.remoteAssistUpsertClient.mockRejectedValue(
      new Error("Remote Assist repository unavailable"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
        displayName: "Front register",
      },
    });

    try {
      const result = await getHandler(submitTerminalRuntimeStatus)(
        ctx as never,
        {
          storeId: "store-1",
          terminalId: "terminal-1",
          syncSecretHash: "sync-secret-1",
          status: buildRuntimeStatus(),
        },
      );

      expect(result).toEqual({
        kind: "ok",
        data: {
          terminalId: "terminal-1",
          reportedAt: 100,
          receivedAt: 200,
        },
      });
      expect(
        mocks.verifyTerminalRecoveryCommandsFromRuntime,
      ).toHaveBeenCalled();
      expect(diagnosticSpy).toHaveBeenCalledWith(
        "[pos-runtime] remote-assist-side-effect-failed",
        expect.objectContaining({
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      );
    } finally {
      diagnosticSpy.mockRestore();
    }
  });

  it("hydrates a runtime Remote Assist session with terminal proof", async () => {
    mocks.remoteAssistGetCurrentSessionForClient.mockResolvedValue(
      buildRemoteAssistSession({ status: "active" }),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(getRuntimeRemoteAssistSession)(ctx as never, {
      storeId: "store-1",
      syncSecretHash: "sync-secret-1",
      terminalId: "terminal-1",
    });

    expect(result).toEqual({
      _id: "remote-session-1",
      effectiveMode: "unattended",
      sensitiveModeActive: false,
      status: "active",
    });
    expect(mocks.remoteAssistGetCurrentSessionForClient).toHaveBeenCalledWith({
      clientId: "remote-client-1",
      now: expect.any(Number),
    });
  });

  it("does not hydrate runtime Remote Assist without terminal proof", async () => {
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(getRuntimeRemoteAssistSession)(ctx as never, {
      storeId: "store-1",
      syncSecretHash: "wrong-secret",
      terminalId: "terminal-1",
    });

    expect(result).toBeNull();
    expect(mocks.remoteAssistGetCurrentSessionForClient).not.toHaveBeenCalled();
  });

  it("disconnects Remote Assist with runtime audit attribution", async () => {
    const session = buildRemoteAssistSession({
      expiresAt: Date.now() + 60_000,
      status: "active",
    });
    mocks.remoteAssistGetSession.mockResolvedValue(session);
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(disconnectRemoteAssistSession)(ctx as never, {
      storeId: "store-1",
      syncSecretHash: "sync-secret-1",
      terminalId: "terminal-1",
      sessionId: "remote-session-1",
    });

    expect(result).toBeNull();
    expect(mocks.remoteAssistPatchSession).toHaveBeenCalledWith(
      "remote-session-1",
      {
        endedAt: expect.any(Number),
        status: "ended",
        terminationReason: "Terminal disconnected Remote Assist.",
      },
    );
    expect(mocks.remoteAssistInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "runtime_disconnected",
        participantRole: "runtime",
        summary: "Terminal disconnected Remote Assist.",
      }),
    );
  });

  it("does not enroll Remote Assist presence after failed runtime status submission", async () => {
    mocks.submitTerminalRuntimeStatusCommand.mockResolvedValue({
      kind: "user_error",
      error: {
        code: "runtime_failed",
        message: "Runtime status was not accepted.",
      },
    });
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(mocks.remoteAssistUpsertClient).not.toHaveBeenCalled();
    expect(mocks.remoteAssistGetCurrentSessionForClient).not.toHaveBeenCalled();
  });

  it("skips Remote Assist enrollment when the store is missing", async () => {
    const ctx = buildCtx({
      store: null,
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(mocks.remoteAssistUpsertClient).not.toHaveBeenCalled();
    expect(mocks.remoteAssistGetCurrentSessionForClient).not.toHaveBeenCalled();
  });

  it("accepts only safe app-session recovery status in runtime check-ins", async () => {
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus({
        appSessionRecovery: {
          status: "blocked_app_account",
          reason: "app_account_disabled",
          assertion: "raw-recovery-assertion",
          diagnostics: { proof: "raw-terminal-proof" },
        },
      }),
    });

    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        status: expect.objectContaining({
          appSessionRecovery: {
            status: "blocked_app_account",
          },
        }),
      }),
    );
    expect(
      mocks.submitTerminalRuntimeStatusCommand.mock.calls[0]?.[1].status
        .appSessionRecovery,
    ).not.toEqual(
      expect.objectContaining({
        assertion: expect.anything(),
        diagnostics: expect.anything(),
        reason: expect.anything(),
      }),
    );
  });

  it("accepts only structured app-update evidence in runtime check-ins", async () => {
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus({
        appUpdate: {
          canApply: false,
          command: { localPayload: { staffProofToken: "raw-proof" } },
          commandExecutionId: "exec-123",
          commandIssuedAt: 90,
          commandNonce: "nonce-abc",
          currentBuildId: "build-current",
          detectorStatus: "ok",
          observedAt: 100,
          pendingBuildId: "build-next",
          selectedBlockerCode: "active_sale",
          stagingStatus: "staged",
          status: "blocked",
          blockerLabel: "Active sale raw customer details",
          localPayload: { customerEmail: "customer@example.com" },
        },
      }),
    });

    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        status: expect.objectContaining({
          appUpdate: {
            blockerSummary: "active_sale",
            canApply: false,
            commandExecutionId: "exec-123",
            commandIssuedAt: 90,
            commandNonce: "nonce-abc",
            currentBuildId: "build-current",
            detectorStatus: "ok",
            observedAt: 100,
            pendingBuildId: "build-next",
            selectedBlockerCode: "active_sale",
            stagingStatus: "staged",
            status: "blocked",
          },
        }),
      }),
    );

    const appUpdate =
      mocks.submitTerminalRuntimeStatusCommand.mock.calls[0]?.[1].status
        .appUpdate;
    expect(appUpdate).not.toEqual(
      expect.objectContaining({
        blockerLabel: expect.anything(),
        localPayload: expect.anything(),
      }),
    );
    expect(appUpdate).not.toEqual(
      expect.objectContaining({ command: expect.anything() }),
    );
  });

  it.each([
    {
      name: "missing terminal",
      terminal: null,
    },
    {
      name: "inactive terminal",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "revoked",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
    {
      name: "wrong store",
      terminal: {
        _id: "terminal-1",
        storeId: "store-2",
        status: "active",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
    {
      name: "missing sync secret",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-1",
      },
    },
    {
      name: "wrong sync secret",
      syncSecretHash: "wrong-sync-secret",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
  ])("does not write runtime status for $name", async (scenario) => {
    const ctx = buildCtx({ terminal: scenario.terminal });

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: scenario.syncSecretHash ?? "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.submitTerminalRuntimeStatusCommand).not.toHaveBeenCalled();
  });

  it("does not require Athena user auth before inspecting terminal runtime proof", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result.kind).toBe("ok");
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(ctx.db.get).toHaveBeenCalledWith("posTerminal", "terminal-1");
    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalled();
  });

  it("requires store membership before listing terminal health summaries", async () => {
    const ctx = buildCtx();

    await getHandler(listTerminalHealthSummaries)(ctx as never, {
      storeId: "store-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.listTerminalHealthSummariesQuery).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
      }),
    );
  });

  it("exports validator-safe terminal health attention reasons", () => {
    const returnValidator = JSON.stringify(
      (listTerminalHealthSummaries as any).exportReturns(),
    );

    for (const value of [
      "attentionReasons",
      "actionTarget",
      "cash_control_register_session",
      "local_review",
      "sync_failed",
      "sync_unavailable",
      "local_store_unavailable",
      "terminal_seed_missing",
      "terminal_authorization_failed",
      "drawer_authority_blocked",
      "cloud_conflict",
      "cloud_held",
      "cloud_rejected",
      "cloud_sync",
      "local_runtime",
      "terminal_runtime",
      "latestReviewEvent",
      "latestReviewEventsByStatus",
      "appUpdate",
      "appUpdateCommandExecutionId",
      "commandCorrelated",
      "evidenceFresh",
      "pendingBuildId",
      "update_ready_unstaged",
      "conflicted",
      "held",
      "rejected",
      "open_work",
      "pos_register",
      "pos_settings",
    ]) {
      expect(returnValidator).toContain(value);
    }
    expect(returnValidator).not.toContain("payload");
    expect(returnValidator).not.toContain("syncSecret");
    expect(returnValidator).not.toContain("staffProofToken");
  });

  it("validates representative terminal health public results against exported return validators", () => {
    const summary = buildTerminalHealthSummaryResult();

    assertConformsToExportedReturns(listTerminalHealthSummaries as never, [
      summary,
    ]);
    assertConformsToExportedReturns(getTerminalHealthSummary as never, summary);
  });

  it("validates representative terminal public read and command results against exported return validators", () => {
    const terminal = buildPublicTerminal();
    const provisionedTerminal = {
      ...terminal,
      syncSecretHash: "sync-secret-hash",
    };
    const recoveryCommand = buildRecoveryCommand({
      acknowledgement: {
        acknowledgedAt: 2,
        clearedLocalReviewEventIds: ["event-review-1"],
        localReviewEvents: [
          {
            createdAt: 1,
            localEventId: "event-review-1",
            localRegisterSessionId: "register-local-1",
            sequence: 1,
            status: "needs_review",
            type: "transaction.completed",
            uploaded: true,
            uploadSequence: 1,
          },
        ],
        result: "completed",
      },
    });
    const commandResult = { kind: "ok" as const, data: recoveryCommand };

    assertConformsToExportedReturns(listTerminals as never, [terminal]);
    assertConformsToExportedReturns(getTerminalByFingerprint as never, terminal);
    assertConformsToExportedReturns(
      previewTerminalRecovery as never,
      buildTerminalHealthSummaryResult().recoveryPreview,
    );
    assertConformsToExportedReturns(submitTerminalRuntimeStatus as never, {
      kind: "ok",
      data: {
        activeRegisterSessionDirective: {
          cloudRegisterSessionId: "register-session-2",
          expectedCash: 13_000,
          localRegisterSessionId: "register-session-2",
          observedAt: 200,
          openedAt: 100,
          openingFloat: 13_000,
          registerNumber: "8",
          staffProfileId: "staff-1",
          status: "active",
        },
        drawerAuthorityDirective: {
          cloudRegisterSessionId: "register-session-1",
          localRegisterSessionId: "local-register-session-1",
          message:
            "The mapped cloud register is closed. Open a register before selling.",
          observedAt: 200,
          reason: "cloud_closed",
          registerNumber: "8",
          status: "blocked",
        },
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    assertConformsToExportedReturns(getRuntimeRemoteAssistSession as never, null);
    assertConformsToExportedReturns(disconnectRemoteAssistSession as never, null);
    assertConformsToExportedReturns(registerTerminal as never, {
      kind: "ok",
      data: provisionedTerminal,
    });
    assertConformsToExportedReturns(updateTerminal as never, terminal);
    assertConformsToExportedReturns(deleteTerminal as never, null);
    assertConformsToExportedReturns(resolveTerminalCloudRepair as never, {
      kind: "ok",
      data: {
        preconditionHash: "terminal-cloud-repair:hash",
        resolvedConflictIds: ["conflict-1"],
        skippedConflictIds: [],
      },
    });
    assertConformsToExportedReturns(issueTerminalRecoveryCommand as never, commandResult);
    assertConformsToExportedReturns(listTerminalRecoveryCommands as never, {
      kind: "ok",
      data: [recoveryCommand],
    });
    assertConformsToExportedReturns(claimTerminalRecoveryCommand as never, commandResult);
    assertConformsToExportedReturns(
      acknowledgeTerminalRecoveryCommand as never,
      commandResult,
    );
  });

  it("requires store membership before loading terminal health detail", async () => {
    const ctx = buildCtx();

    await getHandler(getTerminalHealthSummary)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getTerminalHealthSummaryQuery).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
  });

  it("does not allow sync-secret-only terminal proof to read terminal health", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    await expect(
      getHandler(listTerminalHealthSummaries)(ctx as never, {
        storeId: "store-1",
      }),
    ).rejects.toThrow("not signed in");
    await expect(
      getHandler(getTerminalHealthSummary)(ctx as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("not signed in");
    await expect(
      getHandler(previewTerminalRecovery)(ctx as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("not signed in");

    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.listTerminalHealthSummariesQuery).not.toHaveBeenCalled();
    expect(mocks.getTerminalHealthSummaryQuery).not.toHaveBeenCalled();
    expect(mocks.previewTerminalRecoveryQuery).not.toHaveBeenCalled();
  });

  it("requires full admin membership and actor attribution before cloud repair", async () => {
    const ctx = buildCtx();

    const result = await getHandler(resolveTerminalCloudRepair)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      expectedPreconditionHash: "terminal-cloud-repair:hash",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.resolveTerminalCloudRepairCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        resolvedByUserId: "athena-user-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("requires full admin membership before issuing terminal recovery commands", async () => {
    const ctx = buildCtx();
    mocks.previewTerminalRecoveryQuery.mockResolvedValue({
      appUpdate: null,
      readiness: "healthy_idle",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: false,
      },
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: [],
        skippedConflictIds: [],
      },
      commandStatus: null,
      terminalActions: [],
      manualReview: [],
    });

    const result = await getHandler(issueTerminalRecoveryCommand)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      commandType: "repair_terminal_seed",
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.issueTerminalRecoveryCommandService).toHaveBeenCalledWith(
      { repository: "write" },
      expect.objectContaining({
        commandType: "repair_terminal_seed",
        issuedByUserId: "athena-user-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("issues preview-matched local review cleanup commands", async () => {
    const ctx = buildCtx();
    const clearAction = {
      commandType: "clear_local_review_items",
      commandContext: {
        expectedBlockerType: "local_review",
        localReviewEventIds: ["event-review-1"],
        reason: "Uploaded local review items can be cleared from this terminal.",
      },
      expectedEvidence: {
        localReviewClearedEventIds: ["event-review-1"],
        localReviewEventCount: 0,
      },
      reason: "Uploaded local review items can be cleared from this terminal.",
    };
    mocks.previewTerminalRecoveryQuery.mockResolvedValue({
      appUpdate: {
        description: "Current",
        status: "current",
      },
      readiness: "needs_terminal_action",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: [],
        skippedConflictIds: [],
      },
      commandStatus: null,
      terminalActions: [clearAction],
      manualReview: [],
    });

    const result = await getHandler(issueTerminalRecoveryCommand)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      commandType: "clear_local_review_items",
      commandContext: clearAction.commandContext,
      expectedEvidence: clearAction.expectedEvidence,
    });

    expect(mocks.issueTerminalRecoveryCommandService).toHaveBeenCalledWith(
      { repository: "write" },
      expect.objectContaining({
        commandContext: clearAction.commandContext,
        commandType: "clear_local_review_items",
        expectedEvidence: clearAction.expectedEvidence,
        issuedByUserId: "athena-user-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("issues preview-matched local review clear-all commands", async () => {
    const ctx = buildCtx();
    const clearAllAction = {
      commandType: "clear_local_review_items",
      commandContext: {
        expectedBlockerType: "local_review_clear_all",
        localReviewClearAll: true,
        localReviewClearLimit: 2,
        localReviewEventIds: ["event-review-1", "event-review-2"],
        reason: "Dangerous cleanup for local review items.",
      },
      expectedEvidence: {
        localReviewClearedEventIds: ["event-review-1", "event-review-2"],
        localReviewEventCount: 0,
      },
      reason:
        "Dangerous cleanup can clear all local review items from this terminal.",
    };
    mocks.previewTerminalRecoveryQuery.mockResolvedValue({
      appUpdate: {
        description: "Current",
        status: "current",
      },
      readiness: "needs_terminal_action",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: [],
        skippedConflictIds: [],
      },
      commandStatus: null,
      terminalActions: [clearAllAction],
      manualReview: [],
    });

    const result = await getHandler(issueTerminalRecoveryCommand)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      commandType: "clear_local_review_items",
      commandContext: clearAllAction.commandContext,
      expectedEvidence: clearAllAction.expectedEvidence,
    });

    expect(mocks.issueTerminalRecoveryCommandService).toHaveBeenCalledWith(
      { repository: "write" },
      expect.objectContaining({
        commandContext: clearAllAction.commandContext,
        commandType: "clear_local_review_items",
        expectedEvidence: clearAllAction.expectedEvidence,
        issuedByUserId: "athena-user-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("rejects terminal recovery commands that are not in the current server preview", async () => {
    const ctx = buildCtx();
    mocks.previewTerminalRecoveryQuery.mockResolvedValue({
      appUpdate: {
        description: "Current",
        status: "current",
      },
      readiness: "needs_terminal_action",
      runtimeFresh: true,
      evidence: {
        activeRegisterSession: false,
        freshRuntimeRequiredForAbleToTransactNow: true,
      },
      cloudRepair: {
        preconditionHash: "hash",
        safeConflictIds: [],
        skippedConflictIds: [],
      },
      commandStatus: null,
      terminalActions: [
        {
          commandType: "clear_local_review_items",
          commandContext: {
            expectedBlockerType: "local_review",
            localReviewEventIds: ["event-review-1"],
            reason: "Uploaded local review items can be cleared from this terminal.",
          },
          expectedEvidence: {
            localReviewClearedEventIds: ["event-review-1"],
            localReviewEventCount: 0,
          },
          reason: "Uploaded local review items can be cleared from this terminal.",
        },
      ],
      manualReview: [],
    });

    const result = await getHandler(issueTerminalRecoveryCommand)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      commandType: "clear_local_review_items",
      commandContext: {
        expectedBlockerType: "local_review",
        localReviewClearAll: true,
        reason: "Clear everything.",
      },
      expectedEvidence: {
        localReviewEventCount: 0,
      },
    });

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(mocks.issueTerminalRecoveryCommandService).not.toHaveBeenCalled();
  });

  it.each([
    {
      action: "list",
      handler: listTerminalRecoveryCommands,
      repositoryKind: "read",
      service: mocks.listClaimableTerminalRecoveryCommands,
    },
    {
      action: "claim",
      handler: claimTerminalRecoveryCommand,
      repositoryKind: "write",
      service: mocks.claimTerminalRecoveryCommandService,
    },
    {
      action: "acknowledge",
      handler: acknowledgeTerminalRecoveryCommand,
      repositoryKind: "write",
      service: mocks.acknowledgeTerminalRecoveryCommandService,
    },
  ])(
    "allows terminal runtime to $action recovery commands with only active sync-secret proof",
    async ({ handler, repositoryKind, service }) => {
      mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
        new Error("not signed in"),
      );
      const ctx = buildCtx({
        terminal: {
          _id: "terminal-1",
          storeId: "store-1",
          status: "active",
          registeredByUserId: "athena-user-2",
          syncSecretHash: SYNC_SECRET_HASH,
        },
      });

      const result = await getHandler(handler)(ctx as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        commandId: "command-1",
        result: "completed",
        message: "Done.",
      });

      expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
      expect(service).toHaveBeenCalledWith(
        { repository: repositoryKind },
        expect.any(Object),
      );
      expect(result.kind).toBe("ok");
    },
  );

  it("hides update_app commands from terminals that have not reported app-update runtime evidence", async () => {
    mocks.listClaimableTerminalRecoveryCommands.mockResolvedValue([
      buildRecoveryCommand({
        _id: "command-repair",
        commandType: "repair_terminal_seed",
      }),
      buildRecoveryCommand({
        _id: "command-update",
        commandType: "update_app",
        commandContext: {
          expectedBlockerType: "app_update",
          reason: "Support requested an app update check.",
        },
        expectedEvidence: {},
      }),
    ]);
    mocks.getLatestRuntimeStatusForTerminal.mockResolvedValue({
      appUpdate: undefined,
    });
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(listTerminalRecoveryCommands)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: [expect.objectContaining({ _id: "command-repair" })],
    });
    expect(mocks.createTerminalRecoveryCommandReadRepository).toHaveBeenCalledWith(ctx);
    expect(mocks.createTerminalRecoveryCommandRepository).not.toHaveBeenCalled();
    expect(mocks.listClaimableTerminalRecoveryCommands).toHaveBeenCalledWith(
      { repository: "read" },
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
  });

  it("lists update_app commands after the terminal reports app-update runtime evidence", async () => {
    mocks.listClaimableTerminalRecoveryCommands.mockResolvedValue([
      buildRecoveryCommand({
        _id: "command-update",
        commandType: "update_app",
        commandContext: {
          expectedBlockerType: "app_update",
          reason: "Support requested an app update check.",
        },
        expectedEvidence: {},
      }),
    ]);
    mocks.getLatestRuntimeStatusForTerminal.mockResolvedValue({
      appUpdate: { status: "current" },
    });
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(listTerminalRecoveryCommands)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: [expect.objectContaining({ _id: "command-update" })],
    });
  });

  it("forwards update_app acknowledgement execution ids from terminal runtime proof", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(acknowledgeTerminalRecoveryCommand)(
      ctx as never,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        commandId: "command-1",
        result: "completed",
        message: "Update app evaluated.",
        executionId: "command-1:2000100",
      },
    );

    expect(mocks.acknowledgeTerminalRecoveryCommandService).toHaveBeenCalledWith(
      { repository: "write" },
      expect.objectContaining({
        commandId: "command-1",
        executionId: "command-1:2000100",
        result: "completed",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("forwards local review acknowledgement evidence from terminal runtime proof", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });
    const localReviewEvents = [
      {
        createdAt: 1,
        localEventId: "event-review-1",
        localRegisterSessionId: "register-local-1",
        sequence: 1,
        status: "needs_review",
        type: "transaction.completed",
        uploaded: true,
        uploadSequence: 1,
      },
    ];

    const result = await getHandler(acknowledgeTerminalRecoveryCommand)(
      ctx as never,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        commandId: "command-1",
        result: "completed",
        message: "Local review evidence collected.",
        executionId: "command-1:2000100",
        clearedLocalReviewEventIds: ["event-review-1"],
        localReviewEvents,
      },
    );

    expect(mocks.acknowledgeTerminalRecoveryCommandService).toHaveBeenCalledWith(
      { repository: "write" },
      expect.objectContaining({
        clearedLocalReviewEventIds: ["event-review-1"],
        commandId: "command-1",
        executionId: "command-1:2000100",
        localReviewEvents,
        result: "completed",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it("does not let terminal runtime proof issue terminal recovery commands", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const ctx = buildCtx();

    const result = await getHandler(issueTerminalRecoveryCommand)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      commandType: "repair_terminal_seed",
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message:
          "You do not have access to issue POS terminal recovery commands.",
      },
    });
    expect(mocks.issueTerminalRecoveryCommandService).not.toHaveBeenCalled();
  });

  it("rejects recovery command listing when the terminal sync secret is wrong", async () => {
    const ctx = buildCtx({
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    });

    const result = await getHandler(listTerminalRecoveryCommands)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "wrong-secret",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to list POS terminal recovery commands.",
        metadata: { terminalAuthorizationFailure: true },
      },
    });
    expect(mocks.listClaimableTerminalRecoveryCommands).not.toHaveBeenCalled();
  });

  it.each([
    {
      action: "claim",
      expectedMessage:
        "You do not have access to claim POS terminal recovery commands.",
      handler: claimTerminalRecoveryCommand,
      service: mocks.claimTerminalRecoveryCommandService,
    },
    {
      action: "acknowledge",
      expectedMessage:
        "You do not have access to acknowledge POS terminal recovery commands.",
      handler: acknowledgeTerminalRecoveryCommand,
      service: mocks.acknowledgeTerminalRecoveryCommandService,
    },
  ])(
    "rejects $action recovery commands when the terminal sync secret is wrong",
    async ({ expectedMessage, handler, service }) => {
      const ctx = buildCtx({
        terminal: {
          _id: "terminal-1",
          storeId: "store-1",
          status: "active",
          registeredByUserId: "athena-user-2",
          syncSecretHash: SYNC_SECRET_HASH,
        },
      });

      const result = await getHandler(handler)(ctx as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "wrong-secret",
        commandId: "command-1",
        result: "completed",
      });

      expect(result).toEqual({
        kind: "user_error",
        error: {
          code: "authorization_failed",
          message: expectedMessage,
          metadata: { terminalAuthorizationFailure: true },
        },
      });
      expect(service).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      action: "claim",
      expectedMessage:
        "You do not have access to claim POS terminal recovery commands.",
      handler: claimTerminalRecoveryCommand,
      service: mocks.claimTerminalRecoveryCommandService,
    },
    {
      action: "acknowledge",
      expectedMessage:
        "You do not have access to acknowledge POS terminal recovery commands.",
      handler: acknowledgeTerminalRecoveryCommand,
      service: mocks.acknowledgeTerminalRecoveryCommandService,
    },
  ])(
    "rejects $action recovery commands when the terminal is inactive",
    async ({ expectedMessage, handler, service }) => {
      const ctx = buildCtx({
        terminal: {
          _id: "terminal-1",
          storeId: "store-1",
          status: "revoked",
          registeredByUserId: "athena-user-2",
          syncSecretHash: SYNC_SECRET_HASH,
        },
      });

      const result = await getHandler(handler)(ctx as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
        syncSecretHash: "sync-secret-1",
        commandId: "command-1",
        result: "completed",
      });

      expect(result).toEqual({
        kind: "user_error",
        error: {
          code: "authorization_failed",
          message: expectedMessage,
          metadata: { terminalAuthorizationFailure: true },
        },
      });
      expect(service).not.toHaveBeenCalled();
    },
  );
});

function buildRecoveryCommand(overrides: Record<string, unknown> = {}) {
  return {
    _id: "command-1",
    _creationTime: 1,
    storeId: "store-1",
    terminalId: "terminal-1",
    commandType: "repair_terminal_seed",
    status: "pending",
    verificationStatus: "waiting_for_acknowledgement",
    commandContext: {
      expectedBlockerType: "terminal_seed",
      reason: "Terminal setup data needs repair.",
    },
    expectedEvidence: {
      terminalIntegrityStatus: "healthy",
    },
    issuedByUserId: "athena-user-1",
    issuedAt: 1,
    expiresAt: 901,
    ...overrides,
  };
}

function buildPublicTerminal(overrides: Record<string, unknown> = {}) {
  return {
    _id: "terminal-1",
    _creationTime: 1,
    storeId: "store-1",
    fingerprintHash: "fingerprint-1",
    displayName: "Front register",
    registerNumber: "1",
    loginMode: "pos_only",
    transactionCapability: "products_and_services",
    registeredByUserId: "athena-user-1",
    browserInfo: { userAgent: "test" },
    registeredAt: 1,
    status: "active",
    ...overrides,
  };
}

function buildRuntimeStatus(extra: Record<string, unknown> = {}) {
  return {
    reportedAt: 100,
    source: "sync-runtime",
    appVersion: "1.2.3",
    buildSha: "abc123",
    browserInfo: {
      userAgent: "tests",
      platform: "darwin",
      language: "en",
      online: true,
    },
    localStore: {
      available: true,
      schemaVersion: 3,
      terminalSeedReady: true,
    },
    sync: {
      status: "pending",
      pendingEventCount: 2,
      uploadableEventCount: 2,
      failedEventCount: 0,
      reviewEventCount: 0,
      localOnlyEventCount: 0,
      oldestPendingEventAt: 90,
      nextPendingUploadSequence: 4,
      lastSyncedSequence: 3,
      lastTrigger: "event-append",
    },
    staffAuthority: {
      status: "ready",
      staffProfileId: "staff-1",
      expiresAt: 1000,
    },
    snapshots: {
      catalogAgeMs: 10,
      serviceCatalogAgeMs: 15,
      availabilityAgeMs: 20,
      registerReadModelAgeMs: 30,
    },
    ...extra,
  };
}

function buildCtx(
  overrides: {
    store?: Record<string, unknown> | null | Array<Record<string, unknown> | null>;
    terminal?: Record<string, unknown> | null;
  } = {},
) {
  let storeReadCount = 0;
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          if (Array.isArray(overrides.store)) {
            const store = overrides.store[storeReadCount] ?? null;
            storeReadCount += 1;
            return store;
          }

          return Object.prototype.hasOwnProperty.call(overrides, "store")
            ? overrides.store
            : {
            _id: "store-1",
            organizationId: "org-1",
          };
        }

        if (tableName === "posTerminal" && id === "terminal-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "terminal")
            ? overrides.terminal
            : {
            _id: "terminal-1",
            storeId: "store-1",
            status: "active",
            registeredByUserId: "athena-user-1",
            syncSecretHash: SYNC_SECRET_HASH,
          };
        }

        return null;
      }),
    },
  };
}
