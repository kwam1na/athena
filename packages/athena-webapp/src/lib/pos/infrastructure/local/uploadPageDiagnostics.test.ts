import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  POS_LOCAL_STORE_SCHEMA_VERSION,
  type PosLocalEventRecord,
} from "./posLocalStore";
import { collectUploadPageDiagnostics } from "./uploadPageDiagnostics";
import { executeTerminalRecoveryCommand } from "./terminalRecoveryCommands";
import {
  isPosLocalRuntimeActivityReportCandidate,
  isPosLocalRuntimeDrainCandidate,
} from "./usePosLocalSyncRuntime";

afterEach(() => vi.unstubAllGlobals());

describe("read-only upload page diagnostics", () => {
  it.each([249, 250, 251])(
    "captures a pending event behind %i nonretryable activities without changing records",
    async (blockedCount) => {
      vi.stubGlobal("indexedDB", new IDBFactory());
      vi.stubGlobal("IDBKeyRange", IDBKeyRange);
      const adapter = createIndexedDbPosLocalStorageAdapter({
        databaseName: `diagnostic-${blockedCount}`,
      });
      const store = createPosLocalStore({ adapter });
      await store.initializeStorage();
      const seed = {
        cloudTerminalId: "cloud-terminal",
        terminalId: "local-terminal",
        storeId: "store-1",
        displayName: "Diagnostic fixture",
        provisionedAt: 1,
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        syncSecretHash: "private-seed",
      };
      await store.writeProvisionedTerminalSeed(seed);
      const fixture = (sequence: number): PosLocalEventRecord => ({
        localEventId: `event-${sequence}`,
        sequence,
        createdAt: sequence,
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        storeId: "store-1",
        terminalId: "local-terminal",
        localRegisterSessionId: "local-register",
        staffProfileId: "private-staff",
        staffProofToken: "private-proof",
        payload: { customer: "private-customer" },
        type: "session.started",
        sync: { status: "synced", uploaded: true },
        activity: { status: "failed", reasonCode: "server_rejected" },
      });
      await adapter.transaction(
        "readwrite",
        ["events"],
        async (transaction) => {
          for (let sequence = 1; sequence <= blockedCount; sequence += 1) {
            await transaction.put(
              "events",
              `event-${sequence}`,
              fixture(sequence),
            );
          }
          const pending = {
            ...fixture(blockedCount + 1),
            type: "transaction.completed" as const,
            uploadSequence: 1,
            sync: { status: "pending" as const },
            activity: { status: "pending" as const },
          };
          await transaction.put("events", pending.localEventId, pending);
          await transaction.put("events", "other-store", {
            ...fixture(0),
            localEventId: "other-store",
            storeId: "other-store",
          });
        },
      );
      const before = await store.listEvents();
      const retry = vi.fn();
      const result = await executeTerminalRecoveryCommand({
        command: {
          commandId: "command",
          executionId: "execution",
          type: "report_diagnostics",
          storeId: "store-1",
          terminalId: "cloud-terminal",
        },
        store,
        storeId: "store-1",
        terminalId: "cloud-terminal",
        terminalSeed: seed,
        onRetrySync: retry,
        reportDiagnostics: async (scope) => ({
          uploadPageDiagnostics: await collectUploadPageDiagnostics({
            ...scope,
            store,
            isDrainCandidate: isPosLocalRuntimeDrainCandidate,
            isActivityCandidate: isPosLocalRuntimeActivityReportCandidate,
          }),
        }),
      });
      expect(result.status).toBe("completed");
      const pages = result.uploadPageDiagnostics!.pages.filter(
        (page) => page.terminalId === "local-terminal",
      );
      const candidatePage = pages.findIndex((page) =>
        page.events.some((event) => event.drainCandidate),
      );
      expect(candidatePage).toBe(blockedCount < 250 ? 0 : 1);
      expect(
        pages
          .flatMap((page) => page.events)
          .filter((event) => event.drainCandidate),
      ).toHaveLength(1);
      expect(pages[0].events[0]).toMatchObject({
        activityStatus: "failed",
        activityReasonCode: "server_rejected",
        drainCandidate: false,
        activityCandidate: false,
      });
      expect(JSON.stringify(result)).not.toMatch(/private-|other-store/);
      expect(retry).not.toHaveBeenCalled();
      expect(await store.listEvents()).toEqual(before);
    },
  );
});
