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
    executionId: "command-1:1000",
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
  it("does not execute unclaimed commands without a server-issued execution id", async () => {
    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({ executionId: undefined }),
      store: createPosLocalStore({
        adapter: createMemoryPosLocalStorageAdapter(),
      }),
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      message: "Terminal evidence changed before this recovery command could run.",
      status: "precondition_failed",
    });
  });

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

  it("maps a current app update snapshot to a completed no-op without applying", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn();

    const result = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: false,
          currentBuildId: "build-1",
          status: "current",
        }),
      },
      command: buildCommand({ type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      diagnostics: {
        appUpdateCanApply: false,
        appUpdateStatus: "current",
        currentBuildId: "build-1",
      },
      message: "The terminal is already running the current app.",
      status: "completed",
      type: "update_app",
    });
    expect(result.postAcknowledge).toBeUndefined();
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("prepares an app update apply effect only when the coordinator can apply", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn(() => true);

    const result = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: true,
          currentBuildId: "build-1",
          pendingBuildId: "build-2",
          status: "ready",
        }),
      },
      command: buildCommand({ type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      diagnostics: {
        appUpdateCanApply: true,
        appUpdateStatus: "applying",
        pendingBuildId: "build-2",
      },
      status: "completed",
      type: "update_app",
    });
    expect(applyUpdate).not.toHaveBeenCalled();

    await expect(Promise.resolve(result.postAcknowledge?.())).resolves.toEqual({
      applied: true,
    });

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(applyUpdate).toHaveBeenCalledWith({ bypassUnloadPrompt: true });
  });

  it("applies ready unstaged app updates when cache staging is only diagnostic", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn(() => true);

    const result = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: true,
          pendingBuildId: "build-2",
          status: "ready-unstaged",
        }),
      },
      command: buildCommand({ type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      diagnostics: {
        appUpdateCanApply: true,
        appUpdateStatus: "applying",
        pendingBuildId: "build-2",
      },
      status: "completed",
      type: "update_app",
    });

    await expect(Promise.resolve(result.postAcknowledge?.())).resolves.toEqual({
      applied: true,
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(applyUpdate).toHaveBeenCalledWith({ bypassUnloadPrompt: true });
  });

  it("releases the update command latch when acknowledgement fails", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn(() => true);
    const coordinator = {
      applyUpdate,
      getSnapshot: () => ({
        blockers: [],
        canApply: true,
        pendingBuildId: "build-2",
        status: "ready" as const,
      }),
    };
    const command = buildCommand({
      commandId: "command-latch",
      type: "update_app",
    });

    const first = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: coordinator,
      command,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });
    const duplicateWhileClaimed = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: coordinator,
      command,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    first.onAcknowledgeFailed?.();

    const retryAfterAckFailure = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: coordinator,
      command,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(duplicateWhileClaimed.status).toBe("precondition_failed");
    expect(retryAfterAckFailure.status).toBe("completed");
    expect(retryAfterAckFailure.postAcknowledge).toBeDefined();
  });

  it("reports post-ack app update blockers and releases the latch", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn(() => false);
    const command = buildCommand({
      commandId: "command-post-ack-blocked",
      type: "update_app",
    });

    const result = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: true,
          pendingBuildId: "build-2",
          status: "ready",
        }),
      },
      command,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    await expect(Promise.resolve(result.postAcknowledge?.())).resolves.toEqual({
      applied: false,
      message:
        "App update was accepted, but refresh is now blocked by local work.",
    });

    const retryAfterBlockedApply = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: true,
          pendingBuildId: "build-2",
          status: "ready",
        }),
      },
      command,
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    expect(retryAfterBlockedApply.status).toBe("completed");
  });

  it("does not apply blocked or ready-unstaged app updates", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn();

    const blocked = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [
            {
              generation: 1,
              guidance: "Finish the sale before refreshing.",
              label: "Register sale",
              ownerTabId: "tab-a",
              priority: "critical-workflow",
              surfaceId: "pos-register",
              updatedAt: 1_000,
            },
          ],
          canApply: false,
          pendingBuildId: "build-2",
          status: "blocked",
        }),
      },
      command: buildCommand({ commandId: "command-blocked", type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    const unstaged = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: false,
          pendingBuildId: "build-2",
          status: "ready-unstaged",
        }),
      },
      command: buildCommand({ commandId: "command-unstaged", type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(blocked).toMatchObject({
      diagnostics: { appUpdateStatus: "blocked" },
      message: "The terminal has active work that is blocking app refresh.",
      status: "completed",
    });
    expect(unstaged).toMatchObject({
      diagnostics: { appUpdateStatus: "update_ready_unstaged" },
      message: "An app update is available but is not ready to refresh yet.",
      status: "completed",
    });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("reports detector failure and unavailable coordinator without applying", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn();

    const detectorFailed = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => ({
          blockers: [],
          canApply: false,
          status: "detector-failed",
        }),
      },
      command: buildCommand({ commandId: "command-detector", type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });
    const unavailable = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: null,
      command: buildCommand({ commandId: "command-unavailable", type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(detectorFailed).toMatchObject({
      diagnostics: { appUpdateStatus: "detector_failed" },
      status: "completed",
    });
    expect(unavailable).toMatchObject({
      diagnostics: { appUpdateStatus: "unknown" },
      status: "completed",
    });
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it("reports detector failure when the app update snapshot cannot be read", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const applyUpdate = vi.fn();

    const result = await executeTerminalRecoveryCommand({
      appUpdateCoordinator: {
        applyUpdate,
        getSnapshot: () => {
          throw new Error("coordinator unavailable");
        },
      },
      command: buildCommand({ commandId: "command-snapshot-error", type: "update_app" }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toMatchObject({
      diagnostics: {
        appUpdateStatus: "detector_failed",
      },
      message: "coordinator unavailable",
      status: "completed",
      type: "update_app",
    });
    expect(applyUpdate).not.toHaveBeenCalled();
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

  it("returns precondition_failed when terminal seed identity preconditions drift", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandContext: {
          expectedBlockerType: "terminal_seed",
          expectedTerminalSeedIdentity: "other-terminal",
        },
        commandType: "repair_terminal_seed",
        type: undefined,
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toEqual({
      commandId: "command-1",
      message: "Terminal evidence changed before this recovery command could run.",
      reason: "precondition_failed",
      status: "precondition_failed",
      type: "repair_terminal_seed",
    });
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
        executionId: "backend-command-1:1000",
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

  it("accepts backend-shaped drawer authority command context without a secret payload", async () => {
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
        commandContext: {
          cloudRegisterSessionId: "register-cloud-1",
          expectedBlockerType: "cloud_closed",
          localRegisterSessionId: "register-local-1",
          reason: "Drawer authority requires terminal-local repair.",
        },
        commandType: "clear_stale_drawer_authority",
        expectedEvidence: {
          drawerAuthorityStatus: "healthy",
          localRegisterSessionId: "register-local-1",
        },
        executionId: "backend-command-1:1000",
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
    expect(JSON.stringify(result)).not.toMatch(/syncSecret|payload|proof/i);
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
      status: "precondition_failed",
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

  it("returns precondition_failed when drawer authority is no longer blocked", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "register-cloud-1",
      localRegisterSessionId: "register-local-1",
      observedAt: 1_500,
      reason: "cloud_closed",
      status: "healthy",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    const result = await executeTerminalRecoveryCommand({
      command: buildCommand({
        commandContext: {
          cloudRegisterSessionId: "register-cloud-1",
          expectedBlockerType: "cloud_closed",
          localRegisterSessionId: "register-local-1",
        },
        commandType: "clear_stale_drawer_authority",
        type: undefined,
      }),
      store,
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
      terminalSeed: seed,
    });

    expect(result).toEqual({
      commandId: "command-1",
      message:
        "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.",
      reason: "unsafe_authority_state",
      status: "precondition_failed",
      type: "clear_stale_drawer_authority",
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
    expect(acknowledgement.length).toBeLessThan(1_000);
  });
});
