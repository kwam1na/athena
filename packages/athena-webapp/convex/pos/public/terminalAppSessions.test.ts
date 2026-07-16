import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import {
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

describe("terminal app-session recovery validation", () => {
  it("returns a POS hub-scoped recoverable assertion for an active same-store terminal and POS-only app account", async () => {
    const ctx = await buildCtx();

    const result = await validateTerminalAppSessionRecoveryWithCtx(
      ctx as never,
      buildArgs(),
    );
    assertConformsToExportedReturns(validateTerminalAppSessionRecovery, result);
    assertConformsToExportedReturns(validateTerminalAppSessionRecovery, {
      diagnostics: { reason: "terminal_revoked" },
      reason: "terminal_revoked",
      status: "blocked",
    });
    assertConformsToExportedReturns(validateTerminalAppSessionRecovery, {
      diagnostics: { reason: "transient_failure" },
      status: "retryable",
    });

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
      throw new Error("Expected terminal app-session recovery to be recoverable.");
    }
    expect(result.assertion.expiresAt).toBeGreaterThan(result.assertion.issuedAt);
    expect(result.assertion.expiresAt - result.assertion.issuedAt).toBeLessThanOrEqual(
      5 * 60 * 1000,
    );
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
  ])("blocks non-POS hub route scope %s before terminal/account inspection", async (routeIntent) => {
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
  });

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
    expect(first.assertion.recoveryAttemptId).toBe(second.assertion.recoveryAttemptId);
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

async function buildCtx(seed: {
  accounts?: Array<Record<string, unknown>>;
  members?: Array<Record<string, unknown>>;
  terminal?: Record<string, unknown> | null;
} = {}) {
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
              eq:
                (field, value) =>
                (row) =>
                  row[field] === value,
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
