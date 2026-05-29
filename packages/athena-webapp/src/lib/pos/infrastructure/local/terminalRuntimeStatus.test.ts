import { describe, expect, it } from "vitest";

import {
  buildPosTerminalRuntimeCopyDiagnostics,
  buildPosTerminalRuntimeStatus,
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
    });

    expect(status).toEqual({
      browserInfo: {
        language: "en-US",
        online: true,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 Athena",
      },
      localStore: {
        available: false,
        failureMessage: "syncSecretHash [redacted]",
        schemaVersion: 5,
        terminalSeedReady: true,
      },
      reportedAt: 2_000,
      snapshots: {},
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
          sync: { error: "credential 123456789012345678901234 failed", status: "failed" },
          type: "transaction.completed",
          uploadSequence: 2,
        }),
      ],
      localStoreFailureMessage: "verifier metadata could not be read",
      source: "support-diagnostics",
      staffAuthorityStatus: "expired",
      syncDebug: {
        lastFailure: "token abcdef1234567890abcdef1234567890 rejected",
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
    });

    expect(diagnostics).toEqual(
      expect.objectContaining({
        failures: {
          localStore: "verifier [redacted]",
          sync: "token [redacted]",
        },
        labels: {
          localStore: "unavailable",
          staffAuthority: "expired",
          sync: "failed",
        },
        source: "support-diagnostics",
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
