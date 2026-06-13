import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { getTerminalHealthSummary } from "./terminals";

const now = 2_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("terminal health queries", () => {
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
});

type TestTable =
  | "posLocalSyncConflict"
  | "posLocalSyncCursor"
  | "posLocalSyncEvent"
  | "posTerminal"
  | "posTerminalRecoveryCommand"
  | "posTerminalRuntimeStatus";

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
      query(table: TestTable) {
        return buildQuery(records[table] ?? []);
      },
    },
  } as unknown as QueryCtx;
}

function buildTerminal(): Doc<"posTerminal"> {
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
  };
}

function buildRuntimeStatus(): Doc<"posTerminalRuntimeStatus"> {
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
  };
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
