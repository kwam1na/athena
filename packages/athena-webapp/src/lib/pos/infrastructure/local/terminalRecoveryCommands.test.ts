import { describe, expect, it, vi } from "vitest";

import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalEventRecord,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";
import {
  executeTerminalRecoveryCommand,
  type PosTerminalRecoveryCommand,
} from "./terminalRecoveryCommands";

const seed: PosProvisionedTerminalSeed = {
  cloudTerminalId: "terminal-cloud-1",
  displayName: "Front register",
  provisionedAt: 1_000,
  schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
  storeId: "store-1",
  syncSecretHash: "sync-secret-secret",
  terminalId: "local-terminal-1",
};

function buildCommand(
  overrides: Partial<PosTerminalRecoveryCommand> = {},
): PosTerminalRecoveryCommand {
  return {
    commandId: "command-1",
    storeId: "store-1",
    terminalId: "terminal-cloud-1",
    type: "report_diagnostics",
    ...overrides,
  } as PosTerminalRecoveryCommand;
}

function buildLocalEvent(
  overrides: Partial<PosLocalEventRecord> = {},
): PosLocalEventRecord {
  const sequence = overrides.sequence ?? 1;

  return {
    createdAt: 1,
    localEventId: "event-1",
    localRegisterSessionId: "register-local-1",
    payload: {},
    schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
    sequence,
    staffProfileId: "staff-1",
    staffProofToken: "proof-token-1",
    storeId: "store-1",
    sync: { status: "synced", uploaded: true },
    terminalId: "local-terminal-1",
    type: "register.opened",
    uploadSequence: sequence,
    ...overrides,
  };
}

describe("terminalRecoveryCommands", () => {
  it("repairs the terminal seed and clears terminal integrity only after the seed write succeeds", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeTerminalIntegrityState({
      cloudTerminalId: "terminal-cloud-1",
      observedAt: 1_500,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        type: "repair_terminal_seed",
        payload: {
          seed: {
            ...seed,
            provisionedAt: 2_000,
            syncSecretHash: "new-sync-secret-material",
          },
        },
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toEqual({
      commandId: "command-1",
      diagnostics: {
        terminalId: "terminal-cloud-1",
      },
      status: "completed",
      type: "repair_terminal_seed",
    });
    await expect(store.readProvisionedTerminalSeed()).resolves.toMatchObject({
      ok: true,
      value: {
        provisionedAt: 2_000,
        syncSecretHash: "new-sync-secret-material",
      },
    });
    await expect(
      store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(JSON.stringify(result)).not.toContain("new-sync-secret-material");
  });

  it("repairs terminal seed from safe backend command context without shipping seed material", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeTerminalIntegrityState({
      cloudTerminalId: "terminal-cloud-1",
      observedAt: 1_500,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandContext: {
          expectedBlockerType: "terminal_seed",
          reason: "Terminal setup data needs repair.",
        },
        commandType: "repair_terminal_seed",
        payload: undefined,
        type: undefined,
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      commandId: "command-1",
      status: "completed",
      type: "repair_terminal_seed",
    });
    await expect(
      store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    expect(JSON.stringify(result)).not.toContain("sync-secret-secret");
  });

  it("leaves terminal integrity blocked when repaired seed persistence fails", async () => {
    const store = {
      writeProvisionedTerminalSeedAndClearTerminalIntegrity: vi.fn(
        async () => ({
          ok: false as const,
          error: {
            code: "write_failed" as const,
            message: "syncSecretHash leaked-secret could not be written",
          },
        }),
      ),
    };

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        type: "repair_terminal_seed",
        payload: { seed },
      }),
      store: store as never,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      reason: "local_store_failure",
      status: "failed",
      type: "repair_terminal_seed",
    });
    expect(JSON.stringify(result)).not.toContain("leaked-secret");
  });

  it("clears stale drawer authority only when command preconditions and settled lifecycle events match", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "event-1",
    });
    await store.appendEvent({
      initialSyncStatus: "synced",
      localRegisterSessionId: "register-local-1",
      payload: {},
      storeId: "store-1",
      terminalId: "local-terminal-1",
      type: "register.opened",
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "register-cloud-1",
      localRegisterSessionId: "register-local-1",
      observedAt: 1_500,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        type: "clear_stale_drawer_authority",
        preconditions: {
          blockerReason: "cloud_closed",
          cloudRegisterSessionId: "register-cloud-1",
          localEventSettlement: "settled",
          localRegisterSessionId: "register-local-1",
        },
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      status: "completed",
      type: "clear_stale_drawer_authority",
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "register-local-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("accepts backend-shaped command documents with commandType and safe payload fields", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "event-1",
    });
    await store.appendEvent({
      initialSyncStatus: "synced",
      localRegisterSessionId: "register-local-1",
      payload: {},
      storeId: "store-1",
      terminalId: "local-terminal-1",
      type: "register.opened",
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "register-cloud-1",
      localRegisterSessionId: "register-local-1",
      observedAt: 1_500,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: {
        _id: "backend-command-1",
        commandType: "clear_stale_drawer_authority",
        payload: {
          cloudRegisterSessionId: "register-cloud-1",
          expectedBlockerType: "cloud_closed",
          localRegisterSessionId: "register-local-1",
        },
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      },
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      commandId: "backend-command-1",
      status: "completed",
      type: "clear_stale_drawer_authority",
    });
  });

  it("fails closed and keeps drawer authority when preconditions drift", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.appendEvent(
      buildLocalEvent({
        sync: { status: "pending" },
        type: "register.opened",
      }),
    );
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "register-cloud-1",
      localRegisterSessionId: "register-local-1",
      observedAt: 1_500,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        type: "clear_stale_drawer_authority",
        preconditions: {
          blockerReason: "cloud_closed",
          cloudRegisterSessionId: "register-cloud-1",
          localEventSettlement: "settled",
          localRegisterSessionId: "register-local-1",
        },
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      reason: "precondition_failed",
      status: "failed",
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "register-local-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: expect.objectContaining({ status: "blocked" }),
    });
  });

  it("does not acknowledge commands for another terminal as successful", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        terminalId: "terminal-cloud-other",
        type: "retry_sync",
      }),
      onRetrySync: vi.fn(),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toEqual({
      commandId: "command-1",
      reason: "terminal_mismatch",
      status: "ignored",
      type: "retry_sync",
    });
  });

  it("fails unsupported command types without invoking local callbacks", async () => {
    const onRetrySync = vi.fn();

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({ type: "unknown_command" as never }),
      onRetrySync,
      store: createPosLocalStore({
        adapter: createMemoryPosLocalStorageAdapter(),
      }),
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      reason: "unsupported_command",
      status: "failed",
      type: "unknown_command",
    });
    expect(onRetrySync).not.toHaveBeenCalled();
  });

  it("runs callback-based commands and redacts proof, verifier, PIN, payload, and sync secret material from acknowledgements", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const onRetrySync = vi.fn();
    const refreshStaffAuthority = vi.fn(async () => ({
      status: "ready" as const,
      message:
        "staffProofToken proof-token syncSecretHash sync-secret verifier hash rawPayload { pin: 1234 }",
    }));
    const refreshSnapshots = vi.fn(async () => ({
      message: "raw payload included sync secret secret-value",
      refreshedAt: 3_000,
    }));
    const reportDiagnostics = vi.fn(async () => ({
      message: "PIN 1234 verifier abc proof-token syncSecretHash rawPayload",
    }));

    const retry = await executeTerminalRecoveryCommand({
      command: buildCommand({ type: "retry_sync" }),
      onRetrySync,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });
    const staff = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandId: "command-2",
        type: "refresh_staff_authority",
      }),
      refreshStaffAuthority,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });
    const snapshots = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandId: "command-3",
        type: "refresh_snapshots",
      }),
      refreshSnapshots,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });
    const diagnostics = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandId: "command-4",
        type: "report_diagnostics",
      }),
      reportDiagnostics,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(onRetrySync).toHaveBeenCalled();
    expect(refreshStaffAuthority).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
    expect(refreshSnapshots).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
    expect(reportDiagnostics).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });
    expect([retry, staff, snapshots, diagnostics]).toEqual([
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({ status: "completed" }),
    ]);
    const acknowledgement = JSON.stringify([
      retry,
      staff,
      snapshots,
      diagnostics,
    ]);
    expect(acknowledgement).not.toMatch(
      /proof-token|sync-secret|secret-value|verifier|rawPayload|1234/i,
    );
  });
});
