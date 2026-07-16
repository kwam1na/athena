import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";

const mocks = vi.hoisted(() => ({
  issuePosOfflineAuthorityReceipt: vi.fn(async () => "offline-receipt-1"),
  requirePosApplicationAuthorityWithCtx: vi.fn(),
}));

vi.mock("../application/offlineAuthorityReceipt", () => ({
  issuePosOfflineAuthorityReceipt: mocks.issuePosOfflineAuthorityReceipt,
}));

vi.mock("../application/posApplicationAuthority", () => ({
  requirePosApplicationAuthorityWithCtx:
    mocks.requirePosApplicationAuthorityWithCtx,
}));

import {
  abortPreparedPosTerminalSessionWithCtx,
  abortPreparedPosTerminalSession,
  activatePreparedPosTerminalSession,
  activatePreparedPosTerminalSessionWithCtx,
  cleanupExpiredPosRecoveryArtifacts,
  getCurrentPosTerminalServiceSession,
  refreshCurrentPosTerminalOfflineAuthorityReceipt,
  refreshCurrentPosTerminalOfflineAuthorityReceiptWithCtx,
  validateTerminalAppSessionRecovery,
  validateTerminalAppSessionRecoveryWithCtx,
} from "./terminalAppSessions";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

const STORE_ID = "store-1" as Id<"store">;
const OTHER_STORE_ID = "store-2" as Id<"store">;
const MISSING_STORE_ID = "store-missing" as Id<"store">;
const ORG_ID = "org-1" as Id<"organization">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;
const ACCOUNT_ID = "pos-account-1" as Id<"athenaUser">;
const OTHER_ACCOUNT_ID = "pos-account-2" as Id<"athenaUser">;
const PROOF = "terminal-proof-1";

describe("current terminal service session", () => {
  it("returns only a fully revalidated POS application authority", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValueOnce({
      actor: {
        absoluteExpiresAt: 5_000,
        authSessionId: "auth-session-1",
      },
      posApplicationSessionBindingId: "pos-binding-1",
      offlineAuthorityReceipt: "offline-receipt-1",
      servicePrincipalSessionId: "service-session-1",
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
    });
    const ctx = {};

    const result = await getHandler(getCurrentPosTerminalServiceSession)(
      ctx as never,
      {},
    );

    expect(mocks.requirePosApplicationAuthorityWithCtx).toHaveBeenCalledWith(
      ctx,
    );
    expect(result).toEqual({
      authorityExpiresAt: 5_000,
      authSessionId: "auth-session-1",
      offlineAuthorityReceipt: "offline-receipt-1",
      posApplicationSessionBindingId: "pos-binding-1",
      servicePrincipalSessionId: "service-session-1",
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
    });
  });

  it("normalizes stale or revoked authority failures", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockRejectedValueOnce(
      new Error("terminal revoked"),
    );

    await expect(
      getHandler(getCurrentPosTerminalServiceSession)({} as never, {}),
    ).rejects.toThrow("POS session recovery could not be completed.");
  });
});

describe("terminal app-session recovery validation", () => {
  it("returns a POS hub-scoped recoverable assertion for an active same-store terminal and POS-only app account", async () => {
    const ctx = await buildCtx();

    const result = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs(),
    );
    assertConformsToExportedReturns(validateTerminalAppSessionRecovery, result);

    expect(result).toEqual({
      status: "recoverable",
      assertion: expect.objectContaining({
        accountId: ACCOUNT_ID,
        routeScope: "pos_hub",
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
      }),
      diagnostics: {
        reason: "validated",
      },
    });
    if (result.status !== "recoverable") {
      throw new Error(
        "Expected terminal app-session recovery to be recoverable.",
      );
    }
    expect(result.assertion.expiresAt).toBeGreaterThan(
      result.assertion.issuedAt,
    );
    expect(
      result.assertion.expiresAt - result.assertion.issuedAt,
    ).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(ctx.tables.operationalEvent).toEqual([
      expect.objectContaining({
        eventType: "pos_terminal_app_session_recovery_validated",
        reason: "validated",
        subjectId: TERMINAL_ID,
        subjectType: "posTerminal",
        metadata: expect.objectContaining({
          accountId: ACCOUNT_ID,
          routeScope: "pos_hub",
        }),
      }),
    ]);
    expect(ctx.tables.operationalEvent[0]).not.toHaveProperty("actorUserId");
  });

  it.each([
    "operations",
    "admin",
    "cash_controls",
    "products",
    "services",
    "general_app",
  ])(
    "blocks non-POS hub route scope %s before terminal/account inspection",
    async (routeIntent) => {
      const ctx = await buildCtx();

      const result = await validateTerminalAppSessionRecoveryWithCtx(
        ctx as never,
        buildArgs({ routeIntent }),
      );

      expect(result).toEqual({
        status: "blocked",
        reason: "unsupported_route_scope",
        diagnostics: {
          reason: "unsupported_route_scope",
        },
      });
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(ctx.tables.operationalEvent).toHaveLength(0);
    },
  );

  it.each([
    {
      name: "missing proof",
      args: { terminalProof: undefined },
      reason: "missing_terminal_proof",
      eventReason: null,
    },
    {
      name: "missing terminal",
      terminal: null,
      reason: "terminal_not_available",
      eventReason: null,
    },
    {
      name: "terminal missing sync secret",
      terminal: { syncSecretHash: undefined },
      reason: "invalid_terminal_proof",
      eventReason: null,
    },
    {
      name: "wrong terminal proof",
      args: { terminalProof: "wrong-terminal-proof" },
      reason: "invalid_terminal_proof",
      eventReason: null,
    },
    {
      name: "wrong store",
      args: { storeId: OTHER_STORE_ID },
      reason: "store_mismatch",
      eventReason: "store_mismatch",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "missing terminal store",
      args: { storeId: MISSING_STORE_ID },
      terminal: { storeId: MISSING_STORE_ID },
      reason: "terminal_not_available",
      eventReason: null,
    },
    {
      name: "revoked terminal",
      terminal: { status: "revoked" },
      reason: "terminal_revoked",
      eventReason: "terminal_revoked",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "disabled app account",
      accounts: [],
      reason: "app_account_disabled",
      eventReason: "app_account_disabled",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "missing org membership",
      members: [],
      reason: "app_account_disabled",
      eventReason: "app_account_disabled",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "membership for another account",
      members: [
        {
          _id: "member-1",
          organizationId: ORG_ID,
          role: "pos_only",
          userId: OTHER_ACCOUNT_ID,
        },
      ],
      reason: "app_account_disabled",
      eventReason: "app_account_disabled",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "membership for another organization",
      members: [
        {
          _id: "member-1",
          organizationId: "org-2",
          role: "pos_only",
          userId: ACCOUNT_ID,
        },
      ],
      reason: "app_account_disabled",
      eventReason: "app_account_disabled",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
    {
      name: "full-admin-only app account",
      members: [
        {
          _id: "member-1",
          organizationId: ORG_ID,
          role: "full_admin",
          userId: ACCOUNT_ID,
        },
      ],
      reason: "app_account_not_pos_scoped",
      eventReason: "app_account_not_pos_scoped",
      eventOrganizationId: ORG_ID,
      eventStoreId: STORE_ID,
    },
  ])("blocks recovery for $name with a safe reason", async (scenario) => {
    const ctx = await buildCtx({
      accounts: scenario.accounts,
      members: scenario.members,
      terminal: scenario.terminal,
    });

    const result = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs(scenario.args),
    );

    expect(result).toEqual({
      status: "blocked",
      reason: scenario.reason,
      diagnostics: {
        reason: scenario.reason,
      },
    });
    if (scenario.eventReason === null) {
      expect(ctx.tables.operationalEvent).toHaveLength(0);
    } else {
      expect(ctx.tables.operationalEvent).toEqual([
        expect.objectContaining({
          eventType: "pos_terminal_app_session_recovery_blocked",
          organizationId: scenario.eventOrganizationId,
          reason: scenario.eventReason,
          storeId: scenario.eventStoreId,
          subjectId: TERMINAL_ID,
          subjectType: "posTerminal",
          metadata: expect.objectContaining({
            accountId: ACCOUNT_ID,
            reason: scenario.eventReason,
            routeScope: "pos_hub",
          }),
        }),
      ]);
      expect(ctx.tables.operationalEvent[0]).not.toHaveProperty("actorUserId");
    }
  });

  it("is idempotent for repeated successful recovery validation", async () => {
    const ctx = await buildCtx();

    const first = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs(),
    );
    const second = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs(),
    );

    expect(first.status).toBe("recoverable");
    expect(second.status).toBe("recoverable");
    if (first.status !== "recoverable" || second.status !== "recoverable") {
      throw new Error("Expected repeated recovery checks to stay recoverable.");
    }
    expect(first.assertion.recoveryAttemptId).toBe(
      second.assertion.recoveryAttemptId,
    );
    expect(ctx.tables.operationalEvent).toHaveLength(1);
  });

  it("records separate recovery audit entries for different POS app accounts", async () => {
    const ctx = await buildCtx({
      accounts: [
        {
          _id: ACCOUNT_ID,
          email: "pos@wigclub.store",
        },
        {
          _id: OTHER_ACCOUNT_ID,
          email: "backup-pos@wigclub.store",
        },
      ],
      members: [
        {
          _id: "member-1",
          organizationId: ORG_ID,
          role: "pos_only",
          userId: ACCOUNT_ID,
        },
        {
          _id: "member-2",
          organizationId: ORG_ID,
          role: "pos_only",
          userId: OTHER_ACCOUNT_ID,
        },
      ],
    });

    const first = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs({ accountId: ACCOUNT_ID }),
    );
    const second = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs({ accountId: OTHER_ACCOUNT_ID }),
    );

    expect(first.status).toBe("recoverable");
    expect(second.status).toBe("recoverable");
    expect(ctx.tables.operationalEvent).toHaveLength(2);
    expect(ctx.tables.operationalEvent).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          accountId: ACCOUNT_ID,
        }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          accountId: OTHER_ACCOUNT_ID,
        }),
      }),
    ]);
    expect(ctx.tables.operationalEvent[0]).not.toHaveProperty("actorUserId");
    expect(ctx.tables.operationalEvent[1]).not.toHaveProperty("actorUserId");
  });

  it("does not return or record reusable credentials, proofs, tokens, or OTP material", async () => {
    const ctx = await buildCtx();

    const result = await getHandler(validateTerminalAppSessionRecovery)(
      ctx as never,
      buildArgs({
        terminalProof: "terminal-proof-1",
        metadata: {
          otp: "111222",
          rawToken: "secret-token",
          staffPin: "staff-pin-should-not-leak",
        },
      }),
    );

    const serializedResult = JSON.stringify(result);
    const serializedEvents = JSON.stringify(ctx.tables.operationalEvent);

    for (const secret of [
      PROOF,
      "terminal-proof-1",
      "111222",
      "secret-token",
      "staff-pin-should-not-leak",
      "syncSecretHash",
      "terminalProof",
      "staffPin",
      "rawToken",
      "otp",
    ]) {
      expect(serializedResult).not.toContain(secret);
      expect(serializedEvents).not.toContain(secret);
    }
  });
});

describe("exact-session POS recovery", () => {
  it("activates only the prepared Auth pair and retains the exact result for retry", async () => {
    const ctx = await buildExactSessionCtx();

    const first = await activatePreparedPosTerminalSessionWithCtx(
      ctx as never,
      { now: 1_000 },
    );
    const second = await activatePreparedPosTerminalSessionWithCtx(
      ctx as never,
      { now: 1_001 },
    );

    assertConformsToExportedReturns(activatePreparedPosTerminalSession, first);
    assertConformsToExportedReturns(abortPreparedPosTerminalSession, {
      status: "aborted",
    });
    assertConformsToExportedReturns(getCurrentPosTerminalServiceSession, {
      authorityExpiresAt: first.authorityExpiresAt,
      authSessionId: "auth-session",
      offlineAuthorityReceipt: first.offlineAuthorityReceipt,
      posApplicationSessionBindingId: first.posApplicationSessionBindingId,
      servicePrincipalSessionId: first.servicePrincipalSessionId,
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
    });

    expect(second).toEqual(first);
    expect(ctx.tables.servicePrincipalSession).toHaveLength(1);
    expect(ctx.tables.posApplicationSessionBinding).toHaveLength(1);
    expect(ctx.tables.posApplicationSessionBinding[0]).toEqual(
      expect.objectContaining({
        offlineAuthorityReceipt: "offline-receipt-1",
      }),
    );
    expect(mocks.issuePosOfflineAuthorityReceipt).toHaveBeenCalledWith({
      authorityExpiresAt: 24 * 60 * 60 * 1_000 + 1_000,
      capabilityRevision: 1,
      credentialRevision: 1,
      issuedAt: 1_000,
      posApplicationSessionBindingId: first.posApplicationSessionBindingId,
      principalLifecycleRevision: 1,
      servicePrincipalId: "principal-1",
      servicePrincipalSessionId: first.servicePrincipalSessionId,
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      terminalLifecycleRevision: 1,
      terminalProofRevision: 1,
    });
    expect(ctx.tables.posRecoveryExchange[0]).toEqual(
      expect.objectContaining({
        status: "activated",
        servicePrincipalSessionId: first.servicePrincipalSessionId,
        posApplicationSessionBindingId: first.posApplicationSessionBindingId,
      }),
    );
    expect(ctx.tables.posServicePrincipalMigrationTerminalEvidence).toEqual([
      expect.objectContaining({
        _id: "migration-evidence-target",
        credentialRevision: 1,
        recoveryVersion: 1,
        servicePrincipalSessionId: first.servicePrincipalSessionId,
        status: "recovered",
        successfulRecoveryAt: 1_000,
      }),
      expect.objectContaining({
        _id: "migration-evidence-sibling",
        status: "pending",
      }),
    ]);

    ctx.auth.getUserIdentity.mockResolvedValue({
      subject: "auth-user|different-session",
    });
    await expect(
      activatePreparedPosTerminalSessionWithCtx(ctx as never, { now: 1_002 }),
    ).rejects.toThrow("POS session recovery could not be completed.");
  });

  it("refreshes recovered migration evidence for a later valid exact session", async () => {
    const ctx = await buildExactSessionCtx();
    const first = await activatePreparedPosTerminalSessionWithCtx(
      ctx as never,
      { now: 1_000 },
    );
    const firstExchange = ctx.tables.posRecoveryExchange[0];
    ctx.tables.authSessions.push({
      _id: "auth-session-2",
      userId: "auth-user",
      expirationTime: 200_000,
    });
    ctx.tables.posRecoveryExchange.push({
      ...firstExchange,
      _id: "exchange-2",
      activatedAt: undefined,
      authSessionId: "auth-session-2",
      lastCorrelationId: "recovery_correlation_0002",
      posApplicationSessionBindingId: undefined,
      preparedAt: 1_500,
      recoveryCorrelationKey: "recovery_correlation_0002",
      revision: 1,
      servicePrincipalSessionId: undefined,
      status: "prepared",
      updatedAt: 1_500,
    });
    ctx.auth.getUserIdentity.mockResolvedValue({
      subject: "auth-user|auth-session-2",
    });

    const second = await activatePreparedPosTerminalSessionWithCtx(
      ctx as never,
      { now: 2_000 },
    );

    expect(second.servicePrincipalSessionId).not.toBe(
      first.servicePrincipalSessionId,
    );
    expect(ctx.tables.posTerminal[0].servicePrincipalRecoveryVersion).toBe(2);
    expect(ctx.tables.posServicePrincipalMigrationTerminalEvidence[0]).toEqual(
      expect.objectContaining({
        credentialRevision: 1,
        recoveryVersion: 2,
        servicePrincipalSessionId: second.servicePrincipalSessionId,
        status: "recovered",
        successfulRecoveryAt: 2_000,
      }),
    );
    expect(ctx.tables.servicePrincipalSession).toEqual([
      expect.objectContaining({
        _id: first.servicePrincipalSessionId,
        status: "superseded",
      }),
      expect.objectContaining({
        _id: second.servicePrincipalSessionId,
        status: "active",
      }),
    ]);
  });

  it("refreshes the current receipt only after full POS authority revalidation", async () => {
    const ctx = await buildExactSessionCtx();
    const activated = await activatePreparedPosTerminalSessionWithCtx(
      ctx as never,
      { now: 1_000 },
    );
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValueOnce({
      actor: {
        absoluteExpiresAt: activated.authorityExpiresAt,
        authSessionId: "auth-session",
      },
      posApplicationSessionBindingId: activated.posApplicationSessionBindingId,
      servicePrincipalSessionId: activated.servicePrincipalSessionId,
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
    });
    mocks.issuePosOfflineAuthorityReceipt.mockResolvedValueOnce(
      "offline-receipt-2",
    );

    const refreshed =
      await refreshCurrentPosTerminalOfflineAuthorityReceiptWithCtx(
        ctx as never,
        { now: 2_000 },
      );

    assertConformsToExportedReturns(
      refreshCurrentPosTerminalOfflineAuthorityReceipt,
      refreshed,
    );
    expect(refreshed.offlineAuthorityReceipt).toBe("offline-receipt-2");
    expect(ctx.tables.posApplicationSessionBinding[0]).toEqual(
      expect.objectContaining({
        offlineAuthorityReceipt: "offline-receipt-2",
        revision: 2,
        updatedAt: 2_000,
      }),
    );
  });

  it("fails closed when migration evidence is not bound to the activated principal", async () => {
    const ctx = await buildExactSessionCtx();
    ctx.tables.posServicePrincipalMigrationTerminalEvidence[0].servicePrincipalId =
      "principal-other";

    await expect(
      activatePreparedPosTerminalSessionWithCtx(ctx as never, { now: 1_000 }),
    ).rejects.toThrow("pos_migration_recovery_authority_invalid");
    expect(ctx.tables.posServicePrincipalMigrationTerminalEvidence).toEqual([
      expect.objectContaining({
        _id: "migration-evidence-target",
        status: "pending",
      }),
      expect.objectContaining({
        _id: "migration-evidence-sibling",
        status: "pending",
      }),
    ]);
  });

  it("proof-aborts before token issuance and bounded cleanup removes a later orphan refresh token", async () => {
    const ctx = await buildExactSessionCtx();

    await expect(
      abortPreparedPosTerminalSessionWithCtx(
        ctx as never,
        {
          recoveryCorrelationKey: "recovery_correlation_0001",
          terminalId: TERMINAL_ID,
          terminalProof: PROOF,
        },
        { now: 2_000 },
      ),
    ).resolves.toEqual({ status: "aborted" });
    expect(ctx.tables.authSessions).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange[0].status).toBe("aborted");

    ctx.tables.authRefreshTokens.push({
      _id: "orphan-refresh",
      sessionId: "auth-session",
      expirationTime: 9_999,
    });
    ctx.tables.posRecoveryExchange[0].expiresAt = 1_999;
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 10 }),
    ).resolves.toEqual({ cleaned: 1, progressed: 1 });
    expect(ctx.tables.authRefreshTokens).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange[0]).toEqual(
      expect.objectContaining({
        cleanedAt: expect.any(Number),
        status: "cleaned",
      }),
    );
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 10 }),
    ).resolves.toEqual({ cleaned: 0, progressed: 0 });
  });

  it("resumes bounded refresh cleanup without starving a later exchange", async () => {
    const ctx = await buildExactSessionCtx();
    const firstExchange = ctx.tables.posRecoveryExchange[0];
    firstExchange.status = "aborted";
    firstExchange.expiresAt = 1;
    ctx.tables.authRefreshTokens.push(
      ...Array.from({ length: 65 }, (_, index) => ({
        _id: `refresh-first-${index}`,
        expirationTime: 9_999,
        sessionId: "auth-session",
      })),
    );
    ctx.tables.authSessions.push({
      _id: "auth-session-2",
      expirationTime: 100_000,
      userId: "auth-user",
    });
    ctx.tables.posRecoveryExchange.push({
      ...firstExchange,
      _id: "exchange-2",
      authSessionId: "auth-session-2",
      recoveryCorrelationKey: "recovery_correlation_0002",
      status: "aborted",
    });
    ctx.tables.authRefreshTokens.push({
      _id: "refresh-second",
      expirationTime: 9_999,
      sessionId: "auth-session-2",
    });

    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 0, progressed: 1 });
    expect(
      ctx.tables.authRefreshTokens.filter(
        (token) => token.sessionId === "auth-session",
      ),
    ).toHaveLength(45);
    expect(ctx.tables.posRecoveryExchange[0]).toEqual(
      expect.objectContaining({
        cleanupFinalStatus: "cleaned",
        cleanupStartedAt: expect.any(Number),
        status: "cleanup_pending",
      }),
    );
    expect(ctx.tables.posRecoveryExchange[1].status).toBe("aborted");

    // The attempted exchange moved to the back of the cleanup queue, so the
    // smaller sibling makes progress instead of waiting behind all 65 rows.
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 1, progressed: 1 });
    expect(ctx.tables.posRecoveryExchange[1].status).toBe("cleaned");

    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 0, progressed: 1 });
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 0, progressed: 1 });
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 1, progressed: 1 });
    expect(ctx.tables.authRefreshTokens).toHaveLength(0);
    expect(ctx.tables.posRecoveryExchange[0].status).toBe("cleaned");
    await expect(
      getHandler(cleanupExpiredPosRecoveryArtifacts)(ctx, { limit: 1 }),
    ).resolves.toEqual({ cleaned: 0, progressed: 0 });
  });

  it("requires the exact issued Auth session to abort once refresh authority exists", async () => {
    const ctx = await buildExactSessionCtx();
    ctx.tables.authRefreshTokens.push({
      _id: "refresh-1",
      sessionId: "auth-session",
      expirationTime: 9_999,
    });
    ctx.auth.getUserIdentity.mockResolvedValue({
      subject: "auth-user|different-session",
    });

    await expect(
      abortPreparedPosTerminalSessionWithCtx(ctx as never, {
        recoveryCorrelationKey: "recovery_correlation_0001",
        terminalId: TERMINAL_ID,
        terminalProof: PROOF,
      }),
    ).rejects.toThrow("POS session recovery could not be completed.");
    expect(ctx.tables.authSessions).toHaveLength(1);

    ctx.auth.getUserIdentity.mockResolvedValue({
      subject: "auth-user|auth-session",
    });
    await expect(
      abortPreparedPosTerminalSessionWithCtx(ctx as never, {
        recoveryCorrelationKey: "recovery_correlation_0001",
        terminalId: TERMINAL_ID,
      }),
    ).resolves.toEqual({ status: "aborted" });
    expect(ctx.tables.authRefreshTokens).toHaveLength(0);
  });
});

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    routeIntent: "pos_hub",
    storeId: STORE_ID,
    terminalId: TERMINAL_ID,
    terminalProof: PROOF,
    ...overrides,
  };
}

async function buildCtx(
  seed: {
    accounts?: Array<Record<string, unknown>>;
    members?: Array<Record<string, unknown>>;
    terminal?: Record<string, unknown> | null;
  } = {},
) {
  const terminalProofHash = await hashPosTerminalSyncSecret(PROOF);
  const tables = {
    athenaUser: [
      ...(seed.accounts ?? [
        {
          _id: ACCOUNT_ID,
          email: "pos@wigclub.store",
        },
      ]),
    ],
    operationalEvent: [] as Array<Record<string, unknown>>,
    organizationMember: [
      ...(seed.members ?? [
        {
          _id: "member-1",
          organizationId: ORG_ID,
          role: "pos_only",
          userId: ACCOUNT_ID,
        },
      ]),
    ],
    posTerminal:
      seed.terminal === null
        ? []
        : [
            {
              _id: TERMINAL_ID,
              displayName: "Front register",
              storeId: STORE_ID,
              status: "active",
              syncSecretHash: terminalProofHash,
              ...(seed.terminal ?? {}),
            },
          ],
    store: [
      {
        _id: STORE_ID,
        organizationId: ORG_ID,
      },
      {
        _id: OTHER_STORE_ID,
        organizationId: "org-2",
      },
    ],
  };

  const ctx = {
    tables,
    db: {
      get: vi.fn(async (table: keyof typeof tables, id: string) => {
        return tables[table].find((row) => row._id === id) ?? null;
      }),
      async insert(table: "operationalEvent", value: Record<string, unknown>) {
        const id = `event-${tables.operationalEvent.length + 1}`;
        tables.operationalEvent.push({
          _id: id,
          _creationTime: tables.operationalEvent.length + 1,
          ...value,
        });
        return id;
      },
      query(table: "operationalEvent" | "organizationMember") {
        let rows = [...tables[table]];
        return {
          filter(
            callback: (q: {
              and: (
                ...predicates: Array<(row: Record<string, unknown>) => boolean>
              ) => (row: Record<string, unknown>) => boolean;
              eq: (
                field: string,
                value: unknown,
              ) => (row: Record<string, unknown>) => boolean;
              field: (field: string) => string;
            }) => (row: Record<string, unknown>) => boolean,
          ) {
            const predicate = callback({
              and:
                (...predicates) =>
                (row) =>
                  predicates.every((matches) => matches(row)),
              eq: (field, value) => (row) => row[field] === value,
              field: (field) => field,
            });
            rows = rows.filter(predicate);
            return this;
          },
          withIndex() {
            return this;
          },
          async first() {
            return rows[0] ?? null;
          },
          async collect() {
            return rows;
          },
        };
      },
    },
  };

  return ctx;
}

async function buildExactSessionCtx() {
  let nextId = 1;
  const terminalProofHash = await hashPosTerminalSyncSecret(PROOF);
  const tables: Record<string, any[]> = {
    authRefreshTokens: [],
    authSessions: [
      {
        _id: "auth-session",
        userId: "auth-user",
        expirationTime: 100_000,
      },
    ],
    operationalEvent: [],
    posApplicationSessionBinding: [],
    posServicePrincipalMigrationTerminalEvidence: [
      {
        _id: "migration-evidence-target",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        servicePrincipalId: "principal-1",
        status: "pending",
        terminalLifecycleRevision: 1,
        terminalProofRevision: 1,
        createdAt: 100,
        updatedAt: 100,
      },
      {
        _id: "migration-evidence-sibling",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        terminalId: "terminal-sibling",
        servicePrincipalId: "principal-1",
        status: "pending",
        terminalLifecycleRevision: 1,
        terminalProofRevision: 1,
        createdAt: 100,
        updatedAt: 100,
      },
    ],
    posRecoveryCredential: [
      {
        _id: "credential-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        servicePrincipalId: "principal-1",
        status: "active",
        credentialRevision: 1,
      },
    ],
    posRecoveryExchange: [
      {
        _id: "exchange-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        servicePrincipalId: "principal-1",
        servicePrincipalAuthBindingId: "binding-1",
        authUserId: "auth-user",
        authSessionId: "auth-session",
        terminalId: TERMINAL_ID,
        posRecoveryCredentialId: "credential-1",
        capabilityGrantId: "grant-1",
        recoveryCorrelationKey: "recovery_correlation_0001",
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "prepared",
        revision: 1,
        principalLifecycleRevision: 1,
        capabilityRevision: 1,
        credentialRevision: 1,
        terminalLifecycleRevision: 1,
        terminalProofRevision: 1,
        preparedAt: 100,
        updatedAt: 100,
        expiresAt: 10_000,
        lastCorrelationId: "recovery_correlation_0001",
      },
    ],
    posTerminal: [
      {
        _id: TERMINAL_ID,
        organizationId: ORG_ID,
        storeId: STORE_ID,
        status: "active",
        syncSecretHash: terminalProofHash,
        lifecycleRevision: 1,
        proofRevision: 1,
      },
    ],
    servicePrincipal: [
      {
        _id: "principal-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        stableKey: "store.service",
        status: "active",
        lifecycleRevision: 1,
      },
    ],
    servicePrincipalAuthBinding: [
      {
        _id: "binding-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        servicePrincipalId: "principal-1",
        authUserId: "auth-user",
        status: "active",
        revision: 1,
      },
    ],
    servicePrincipalCapability: [
      {
        _id: "grant-1",
        organizationId: ORG_ID,
        storeId: STORE_ID,
        servicePrincipalId: "principal-1",
        consumerId: "pos",
        capabilityId: "pos.application",
        status: "active",
        revision: 1,
      },
    ],
    servicePrincipalSession: [],
    store: [{ _id: STORE_ID, organizationId: ORG_ID }],
  };
  const auth = {
    getUserIdentity: vi.fn(async () => ({
      subject: "auth-user|auth-session",
    })),
  };
  const db = {
    get: vi.fn(async (tableOrId: string, maybeId?: string) => {
      if (maybeId !== undefined) {
        return tables[tableOrId]?.find((row) => row._id === maybeId) ?? null;
      }
      return (
        Object.values(tables)
          .flat()
          .find((row) => row._id === tableOrId) ?? null
      );
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      tables[table].push({ _id: id, ...value });
      return id;
    }),
    patch: vi.fn(
      async (
        tableOrId: string,
        idOrPatch: string | Record<string, unknown>,
        maybePatch?: Record<string, unknown>,
      ) => {
        const id = typeof idOrPatch === "string" ? idOrPatch : tableOrId;
        const update = typeof idOrPatch === "string" ? maybePatch! : idOrPatch;
        const row = Object.values(tables)
          .flat()
          .find((candidate) => candidate._id === id);
        if (!row) throw new Error(`Missing row ${id}`);
        Object.assign(row, update);
      },
    ),
    delete: vi.fn(async (tableOrId: string, maybeId?: string) => {
      const id = maybeId ?? tableOrId;
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((row) => row._id === id);
        if (index >= 0) {
          rows.splice(index, 1);
          return;
        }
      }
    }),
    query: vi.fn((table: string) => createExactQuery(tables[table] ?? [])),
  };
  return { auth, db, tables };
}

function createExactQuery(rows: any[]) {
  let currentRows = [...rows];
  const query = {
    collect: vi.fn(async () => currentRows),
    filter: vi.fn((predicate: Function) => {
      currentRows = currentRows.filter((row) =>
        predicate({
          and: (...values: boolean[]) => values.every(Boolean),
          eq: (left: unknown, right: unknown) => left === right,
          field: (name: string) => row[name],
          or: (...values: boolean[]) => values.some(Boolean),
        }),
      );
      return query;
    }),
    first: vi.fn(async () => currentRows[0] ?? null),
    take: vi.fn(async (limit: number) => currentRows.slice(0, limit)),
    withIndex: vi.fn((_name: string, predicate?: Function) => {
      if (predicate) {
        const indexBuilder = {
          eq: (field: string, value: unknown) => {
            currentRows = currentRows.filter((row) => row[field] === value);
            return indexBuilder;
          },
          lte: (field: string, value: number) => {
            currentRows = currentRows.filter((row) => row[field] <= value);
            return indexBuilder;
          },
        };
        predicate(indexBuilder);
      }
      return query;
    }),
  };
  return query;
}
