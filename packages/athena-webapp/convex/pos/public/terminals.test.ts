import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledgeTerminalRecoveryCommandService: vi.fn(),
  claimTerminalRecoveryCommandService: vi.fn(),
  createTerminalRecoveryCommandRepository: vi.fn(),
  deleteTerminalCommand: vi.fn(),
  getTerminalHealthSummaryQuery: vi.fn(),
  getTerminalByFingerprintQuery: vi.fn(),
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
  createTerminalRecoveryCommandRepository:
    mocks.createTerminalRecoveryCommandRepository,
}));

vi.mock("../../remoteAssist/infrastructure/remoteAssistRepository", () => ({
  createRemoteAssistRepository: mocks.createRemoteAssistRepository,
}));

import {
  deleteTerminal,
  getTerminalByFingerprint,
  getTerminalHealthSummary,
  getRuntimeRemoteAssistSession,
  issueTerminalRecoveryCommand,
  listTerminalRecoveryCommands,
  listTerminalHealthSummaries,
  listTerminals,
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
    mocks.createTerminalRecoveryCommandRepository.mockReturnValue({
      repository: true,
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

  it("accepts redacted runtime status from an authorized store member", async () => {
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
              sequence: 9,
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
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
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
      store: [
        {
          _id: "store-1",
          organizationId: "org-1",
        },
        null,
      ],
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

  it("does not inspect terminal credentials when runtime status store membership is denied", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
      },
    });
    expect(ctx.db.get).toHaveBeenCalledWith("store", "store-1");
    expect(ctx.db.get).not.toHaveBeenCalledWith("posTerminal", "terminal-1");
    expect(mocks.submitTerminalRuntimeStatusCommand).not.toHaveBeenCalled();
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
      { repository: true },
      expect.objectContaining({
        commandType: "repair_terminal_seed",
        issuedByUserId: "athena-user-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
    expect(result.kind).toBe("ok");
  });

  it.each([
    {
      action: "list",
      handler: listTerminalRecoveryCommands,
      service: mocks.listClaimableTerminalRecoveryCommands,
    },
    {
      action: "claim",
      handler: claimTerminalRecoveryCommand,
      service: mocks.claimTerminalRecoveryCommandService,
    },
    {
      action: "acknowledge",
      handler: acknowledgeTerminalRecoveryCommand,
      service: mocks.acknowledgeTerminalRecoveryCommandService,
    },
  ])(
    "allows POS store members to $action recovery commands with the active sync secret",
    async ({ handler, service }) => {
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

      expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          allowedRoles: ["full_admin", "pos_only"],
          organizationId: "org-1",
          userId: "athena-user-1",
        }),
      );
      expect(service).toHaveBeenCalled();
      expect(result.kind).toBe("ok");
    },
  );

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
