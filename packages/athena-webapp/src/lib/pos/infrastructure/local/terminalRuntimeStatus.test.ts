import { describe, expect, it } from "vitest";

import {
  buildPosTerminalRuntimeCopyDiagnostics,
  buildPosTerminalRuntimeStatus,
  type PosTerminalRuntimeAppSessionRecoveryInput,
  type PosTerminalRuntimeStatusInput,
} from "./terminalRuntimeStatus";
import type { PosLocalEventRecord } from "./posLocalStore";

describe("terminalRuntimeStatus", () => {
  it("builds a server check-in payload from local sync state without sensitive fields", () => {
    const status = buildPosTerminalRuntimeStatus({
      browserInfo: {
        language: "en-US",
        online: true,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 Athena",
      },
      appVersion: "gentle-lion-climbs (20260608193135)",
      buildSha: "b463caa2d36dabcdef",
      clock: () => 2_000,
      events: [
        buildLocalEvent({
          localEventId: "event-open",
          payload: {
            openingFloat: 10_000,
            verifier: { hash: "pin-hash" },
          },
          sequence: 1,
          staffProofToken: "staff-proof-token",
          type: "register.opened",
          uploadSequence: 1,
        }),
        buildLocalEvent({
          localEventId: "event-sale",
          localPosSessionId: "sale-1",
          localTransactionId: "transaction-1",
          payload: {
            customerEmail: "customer@example.com",
            customerName: "Customer Name",
            payments: [{ amount: 10_000, method: "cash" }],
            total: 10_000,
          },
          sequence: 2,
          staffProofToken: "staff-proof-token",
          type: "transaction.completed",
          uploadSequence: 2,
        }),
        buildLocalEvent({
          localEventId: "event-local-note",
          sequence: 3,
          sync: { status: "synced" },
          type: "cart.item_added",
          uploadSequence: undefined,
        }),
      ],
      localStoreFailureMessage:
        "syncSecretHash abcdef1234567890abcdef1234567890 failed",
      snapshots: {
        availabilityRefreshedAt: 1_880,
        catalogRefreshedAt: 1_760,
        serviceCatalogRefreshedAt: 1_820,
      },
      source: "register",
      staffAuthorityStatus: "ready",
      staffProfileId: "staff-1",
      syncDebug: {
        failedEventCount: 0,
        lastFailure: "staffProofToken secret-token-value failed",
        lastTrigger: "event-appended",
        localOnlyEventCount: 1,
        nextPendingUploadSequence: 1,
        oldestPendingEventAt: 1_000,
        pendingUploadEventCount: 2,
        reviewEventCount: 0,
      },
      terminalSeed: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front register",
        provisionedAt: 1_000,
        schemaVersion: 5,
        storeId: "store-1",
        syncSecretHash: "sync-secret-hash",
        terminalId: "local-terminal-1",
      },
      terminalIntegrity: {
        message: "syncSecretHash secret should not leave local storage",
        observedAt: 1_990,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
      drawerAuthority: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "register-1",
        message: "staffProofToken secret should not leave local storage",
        observedAt: 1_995,
        reason: "cloud_closed",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    expect(status).toEqual({
      appVersion: "gentle-lion-climbs (20260608193135)",
      browserInfo: {
        language: "en-US",
        online: true,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 Athena",
      },
      buildSha: "b463caa2d36dabcdef",
      localStore: {
        available: false,
        failureMessage: "syncSecretHash [redacted]",
        schemaVersion: 5,
        terminalSeedReady: true,
      },
      reportedAt: 2_000,
      snapshots: {
        availabilityAgeMs: 120,
        catalogAgeMs: 240,
        serviceCatalogAgeMs: 180,
      },
      source: "register",
      staffAuthority: {
        staffProfileId: "staff-1",
        status: "ready",
      },
      sync: {
        failedEventCount: 0,
        lastFailureMessage: "staffProofToken [redacted]",
        lastSyncedSequence: 0,
        lastTrigger: "event-appended",
        localOnlyEventCount: 1,
        nextPendingUploadSequence: 1,
        oldestPendingEventAt: 1_000,
        pendingEventCount: 2,
        reviewEventCount: 0,
        reviewEvents: [],
        status: "pending",
        uploadableEventCount: 2,
      },
      terminalIntegrity: {
        observedAt: 1_990,
        reason: "authorization_failed",
        status: "requires_reprovision",
      },
      drawerAuthority: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "register-1",
        observedAt: 1_995,
        reason: "cloud_closed",
        status: "blocked",
      },
    });

    expect(JSON.stringify(status)).not.toContain("staff-proof-token");
    expect(JSON.stringify(status)).not.toContain("sync-secret-hash");
    expect(JSON.stringify(status)).not.toContain("pin-hash");
    expect(JSON.stringify(status)).not.toContain("customer@example.com");
    expect(JSON.stringify(status)).not.toContain("payments");
  });

  it("builds copy diagnostics with identifiers, counts, sequences, timestamps, and labels only", () => {
    const diagnostics = buildPosTerminalRuntimeCopyDiagnostics({
      clock: () => 2_000,
      events: [
        buildLocalEvent({
          createdAt: 1_000,
          localEventId: "event-sale",
          localPosSessionId: "sale-1",
          localRegisterSessionId: "register-1",
          localTransactionId: "transaction-1",
          payload: {
            customerName: "Customer Name",
            payments: [{ amount: 10_000, method: "cash" }],
          },
          sequence: 2,
          sync: {
            error: "credential 123456789012345678901234 failed",
            status: "failed",
          },
          type: "transaction.completed",
          uploadSequence: 2,
        }),
      ],
      localStoreFailureMessage:
        "verifier metadata PIN 1234 rawPayload customer payload could not be read",
      source: "support-diagnostics",
      staffAuthorityStatus: "expired",
      syncDebug: {
        lastFailure: "PIN 1234 rawPayload customer body rejected",
      },
      terminalSeed: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front register",
        provisionedAt: 1_000,
        registerNumber: "1",
        schemaVersion: 5,
        storeId: "store-1",
        syncSecretHash: "sync-secret-hash",
        terminalId: "local-terminal-1",
      },
      terminalIntegrity: {
        observedAt: 1_900,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
      drawerAuthority: {
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "register-1",
        observedAt: 1_950,
        reason: "cloud_closed",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    expect(diagnostics).toEqual(
      expect.objectContaining({
        failures: {
          localStore: "verifier [redacted]",
          sync: "PIN [redacted]",
        },
        labels: {
          drawerAuthority: "blocked",
          localStore: "unavailable",
          staffAuthority: "expired",
          sync: "failed",
          terminalIntegrity: "blocked",
        },
        source: "support-diagnostics",
        authority: {
          drawer: {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "register-1",
            reason: "cloud_closed",
            status: "blocked",
          },
          terminal: {
            reason: "authorization_failed",
            status: "requires_reprovision",
          },
        },
        terminal: {
          cloudTerminalId: "terminal-cloud-1",
          displayName: "Front register",
          localTerminalId: "local-terminal-1",
          registerNumber: "1",
          storeId: "store-1",
        },
      }),
    );
    expect(diagnostics.events).toEqual([
      {
        createdAt: 1_000,
        localEventId: "event-sale",
        localPosSessionId: "sale-1",
        localRegisterSessionId: "register-1",
        localTransactionId: "transaction-1",
        sequence: 2,
        staffProfileId: "staff-1",
        status: "failed",
        type: "transaction.completed",
        uploadSequence: 2,
      },
    ]);

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("PIN 1234");
    expect(serialized).not.toContain("payments");
    expect(serialized).not.toContain("Customer Name");
    expect(serialized).not.toContain("sync-secret-hash");
    expect(serialized).not.toContain("123456789012345678901234");
  });

  it("includes sanitized local review event samples in server check-ins", () => {
    const status = buildPosTerminalRuntimeStatus({
      clock: () => 2_000,
      events: [
        buildLocalEvent({
          localEventId: "event-review",
          localPosSessionId: "sale-1",
          localTransactionId: "transaction-1",
          payload: {
            customerEmail: "customer@example.com",
            payments: [{ amount: 10_000, method: "cash" }],
          },
          sequence: 5,
          sync: { status: "needs_review", uploaded: true },
          type: "transaction.completed",
          uploadSequence: 2,
        }),
      ],
      source: "register",
    });

    expect(status.sync.reviewEvents).toEqual([
      {
        createdAt: 1_000,
        localEventId: "event-review",
        localPosSessionId: "sale-1",
        localRegisterSessionId: "register-1",
        localTransactionId: "transaction-1",
        sequence: 5,
        staffProfileId: "staff-1",
        status: "needs_review",
        type: "transaction.completed",
        uploaded: true,
        uploadSequence: 2,
      },
    ]);
    expect(JSON.stringify(status.sync.reviewEvents)).not.toContain("payments");
    expect(JSON.stringify(status.sync.reviewEvents)).not.toContain(
      "customer@example.com",
    );
  });

  it("reports sale authority when the local terminal can transact now", () => {
    const status = buildPosTerminalRuntimeStatus({
      clock: () => 2_000,
      events: [],
      source: "register",
      staffAuthorityStatus: "ready",
      staffProfileId: "staff-1",
      terminalSeed: {
        cloudTerminalId: "terminal-cloud-1",
        displayName: "Front register",
        provisionedAt: 1_000,
        schemaVersion: 5,
        storeId: "store-1",
        syncSecretHash: "sync-secret-hash",
        terminalId: "local-terminal-1",
      },
    });

    expect(status.saleAuthority).toEqual({
      observedAt: 2_000,
      staffProfileId: "staff-1",
      status: "ready",
      transactionMode: "products_and_services",
    });
    expect(JSON.stringify(status.saleAuthority)).not.toContain("sync-secret");
  });

  it("reports uncertainty metadata as support-safe counts without exposing payload details", () => {
    const input = {
      clock: () => 2_000,
      events: [
        buildLocalEvent({
          localEventId: "event-offline-sale",
          localPosSessionId: "sale-1",
          localTransactionId: "transaction-1",
          payload: {
            customerEmail: "customer@example.com",
            payments: [{ amount: 10_000, method: "cash" }],
            rawTerminalProof: "terminal-proof-secret",
          },
          sequence: 2,
          type: "transaction.completed",
          uploadSequence: 2,
          validationMetadata: {
            flags: ["app-session-unverified", "cloud-validation-uncertain"],
            observedAt: 1_500,
            uploadDeferredUntil: "app-session-validated",
          },
        }),
      ],
      source: "support-diagnostics",
    } satisfies PosTerminalRuntimeStatusInput;

    const status = buildPosTerminalRuntimeStatus(input);
    const diagnostics = buildPosTerminalRuntimeCopyDiagnostics(input);

    expect(status.sync).toEqual(
      expect.objectContaining({
        localOnlyEventCount: 1,
        pendingEventCount: 1,
        uploadableEventCount: 0,
      }),
    );
    expect(diagnostics.counts).toEqual(
      expect.objectContaining({
        appSessionUnverifiedEventCount: 1,
        cloudValidationUncertainEventCount: 1,
        deferredUploadEventCount: 1,
        localOnlyEventCount: 1,
        uploadableEventCount: 0,
      }),
    );
    expect(diagnostics.events).toEqual([
      expect.objectContaining({
        localEventId: "event-offline-sale",
        status: "pending",
        type: "transaction.completed",
        uploadSequence: 2,
      }),
    ]);
    const serialized = JSON.stringify({ diagnostics, status });
    expect(serialized).not.toContain("payments");
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("terminal-proof-secret");
  });

  it.each([
    {
      expected: "ready",
      recovery: { status: "idle" },
    },
    {
      expected: "ready",
      recovery: { assertion: "present", status: "recoverable" },
    },
    {
      expected: "recovering",
      recovery: { status: "validating" },
    },
    {
      expected: "retrying",
      recovery: { status: "retrying" },
    },
    {
      expected: "waiting_for_network",
      recovery: { status: "waiting_for_network" },
    },
    {
      expected: "blocked_store_mismatch",
      recovery: { reason: "store_mismatch", status: "blocked" },
    },
    {
      expected: "blocked_app_account",
      recovery: { reason: "app_account_not_pos_scoped", status: "blocked" },
    },
    {
      expected: "retry_exhausted",
      recovery: { reason: "retry_exhausted", status: "blocked" },
    },
    {
      expected: "stale_assertion",
      recovery: { reason: "stale_assertion", status: "blocked" },
    },
    {
      expected: "blocked_terminal",
      recovery: { reason: "terminal_revoked", status: "blocked" },
    },
  ] satisfies Array<{
    expected: string;
    recovery: PosTerminalRuntimeAppSessionRecoveryInput;
  }>)(
    "maps app-session recovery $expected to support-safe runtime status and copy diagnostics",
    ({ expected, recovery }) => {
      const input = {
        appSessionRecovery: recovery,
        clock: () => 2_000,
        events: [],
        source: "register",
      } satisfies PosTerminalRuntimeStatusInput;

      const status = buildPosTerminalRuntimeStatus(input);
      const diagnostics = buildPosTerminalRuntimeCopyDiagnostics(input);

      expect(status.appSessionRecovery).toEqual({
        status: expected,
      });
      expect(diagnostics.appSessionRecovery).toEqual({
        status: expected,
      });
      expect(diagnostics.labels.appSessionRecovery).toBe(expected);

      const serialized = JSON.stringify({ diagnostics, status });
      if (
        recovery.reason === "app_account_not_pos_scoped" ||
        recovery.reason === "terminal_revoked"
      ) {
        expect(serialized).not.toContain(recovery.reason);
      }
    },
  );

  it("keeps terminal and drawer authority as the sale gates when app-session recovery is ready", () => {
    const diagnostics = buildPosTerminalRuntimeCopyDiagnostics({
      appSessionRecovery: {
        assertion: "present",
        status: "recoverable",
      },
      clock: () => 2_000,
      drawerAuthority: {
        localRegisterSessionId: "register-1",
        observedAt: 1_995,
        reason: "lifecycle_rejected",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
      events: [],
      source: "register",
      terminalIntegrity: {
        observedAt: 1_990,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      },
    });

    expect(diagnostics.labels.appSessionRecovery).toBe("ready");
    expect(diagnostics.labels.terminalIntegrity).toBe("blocked");
    expect(diagnostics.labels.drawerAuthority).toBe("blocked");
    expect(diagnostics.authority).toEqual({
      drawer: {
        localRegisterSessionId: "register-1",
        reason: "lifecycle_rejected",
        status: "blocked",
      },
      terminal: {
        reason: "authorization_failed",
        status: "requires_reprovision",
      },
    });
  });
});

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord> = {},
): PosLocalEventRecord {
  const sequence = overrides.sequence ?? 1;

  return {
    createdAt: 1_000,
    localEventId: `event-${sequence}`,
    localRegisterSessionId: "register-1",
    payload: {},
    schemaVersion: 5,
    sequence,
    staffProfileId: "staff-1",
    staffProofToken: "staff-proof-token",
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "local-terminal-1",
    type: "register.opened",
    uploadSequence: sequence,
    ...overrides,
  };
}
