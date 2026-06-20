import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  acknowledgeTerminalRecoveryCommand,
  claimTerminalRecoveryCommand,
  issueTerminalRecoveryCommand,
  listClaimableTerminalRecoveryCommands,
  verifyTerminalRecoveryCommandsFromRuntime,
} from "./terminalCommandService";

const now = 2_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("terminal command service", () => {
  it("issues, claims, acknowledges, and waits for runtime verification", async () => {
    const repository = buildRepository();

    const issued = await issueTerminalRecoveryCommand(repository, {
      commandType: "retry_sync",
      expectedEvidence: {
        syncStatus: "idle",
      },
      issuedAt: now,
      issuedByUserId: "user-1" as Id<"athenaUser">,
      commandContext: {
        reason: "Support requested sync retry.",
      },
      storeId,
      terminalId,
    });

    expect(issued.kind).toBe("ok");
    const commandId =
      issued.kind === "ok" ? issued.data._id : ("never" as Id<"posTerminalRecoveryCommand">);

    const claimable = await listClaimableTerminalRecoveryCommands(repository, {
      now,
      storeId,
      terminalId,
    });
    expect(claimable).toHaveLength(1);

    const claimed = await claimTerminalRecoveryCommand(repository, {
      claimedAt: now + 100,
      commandId,
      storeId,
      terminalId,
    });
    expect(claimed.kind).toBe("ok");
    expect(repository.patchCommand).toHaveBeenCalledWith(
      commandId,
      expect.objectContaining({ status: "claimed" }),
    );

    const acknowledged = await acknowledgeTerminalRecoveryCommand(repository, {
      acknowledgedAt: now + 200,
      commandId,
      message: "Sync retry scheduled.",
      result: "completed",
      storeId,
      terminalId,
    });
    expect(acknowledged.kind).toBe("ok");
    expect(repository.patchCommand).toHaveBeenLastCalledWith(
      commandId,
      expect.objectContaining({
        acknowledgement: expect.objectContaining({
          result: "completed",
        }),
        status: "completed",
        verificationStatus: "runtime_verification_ready",
      }),
    );
  });

  it("rejects secret-like commandContext fields before audit persistence", async () => {
    const repository = buildRepository();

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "repair_terminal_seed",
      expectedEvidence: {},
      issuedAt: now,
      issuedByUserId: "user-1" as Id<"athenaUser">,
      commandContext: {
        syncSecret: "secret",
      } as never,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
      },
      kind: "user_error",
    });
    expect(repository.insertCommand).not.toHaveBeenCalled();
  });

  it("issues update_app with command-correlated expected evidence", async () => {
    const repository = buildRepository();

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "update_app",
      expectedEvidence: {
        appUpdateCommandExecutionId: "execution-1",
        appUpdateStatus: "current",
      },
      issuedAt: now,
      issuedByUserId: "user-1" as Id<"athenaUser">,
      commandContext: {
        reason: "Support requested app update.",
      },
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        commandType: "update_app",
        expectedEvidence: {
          appUpdateCommandExecutionId: "execution-1",
          appUpdateStatus: "current",
        },
        status: "pending",
      },
    });
  });

  it("dedupes active update_app work without freezing support-side build metadata", async () => {
    const existingCommand = buildCommand({
      commandType: "update_app",
      commandContext: {
        reason: "Support requested app update.",
      },
      expectedEvidence: {
        appUpdateStatus: "current",
      },
      status: "claimed",
    });
    const repository = buildRepository({
      commands: [existingCommand],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "update_app",
      expectedEvidence: {
        appUpdateStatus: "update_ready",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        reason: "Support requested app update after a newer check-in.",
      },
      storeId,
      terminalId,
    });

    expect(result).toEqual({
      kind: "ok",
      data: existingCommand,
    });
    expect(repository.insertCommand).not.toHaveBeenCalled();
  });

  it("allows update_app retry after completed no-op evaluation", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          commandType: "update_app",
          commandContext: {
            reason: "Support requested app update.",
          },
          expectedEvidence: {
            appUpdateStatus: "current",
          },
          status: "completed",
          verificationStatus: "verified",
        }),
      ],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "update_app",
      expectedEvidence: {
        appUpdateStatus: "current",
      },
      issuedAt: now + 1_000,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        reason: "Support requested app update again.",
      },
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "command-2",
        commandType: "update_app",
        status: "pending",
      },
    });
    expect(repository.insertCommand).toHaveBeenCalled();
  });

  it("requires the update_app claim execution id for acknowledgement", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          commandType: "update_app",
          status: "pending",
        }),
      ],
    });

    const claimed = await claimTerminalRecoveryCommand(repository, {
      claimedAt: now + 100,
      commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
      storeId,
      terminalId,
    });

    expect(claimed).toMatchObject({
      kind: "ok",
      data: {
        executionId: "command-1:2000100",
        status: "claimed",
      },
    });

    await expect(
      acknowledgeTerminalRecoveryCommand(repository, {
        acknowledgedAt: now + 200,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        executionId: "stale-execution",
        result: "completed",
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
        message: "This terminal recovery command claim is stale.",
      },
      kind: "user_error",
    });

    await expect(
      acknowledgeTerminalRecoveryCommand(repository, {
        acknowledgedAt: now + 300,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        executionId: "command-1:2000100",
        result: "completed",
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        status: "completed",
      },
    });
  });

  it("rejects concurrent update_app claims after the first consumer claims it", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          commandType: "update_app",
          status: "pending",
        }),
      ],
    });

    await expect(
      claimTerminalRecoveryCommand(repository, {
        claimedAt: now + 100,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      data: {
        executionId: "command-1:2000100",
      },
    });

    await expect(
      claimTerminalRecoveryCommand(repository, {
        claimedAt: now + 200,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
        message: "This terminal recovery command is already claimed.",
      },
      kind: "user_error",
    });
  });

  it("rejects secret-like update_app expected evidence before audit persistence", async () => {
    const repository = buildRepository();

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "update_app",
      expectedEvidence: {
        appUpdateStatus: "current",
        syncSecret: "do-not-store",
      } as never,
      issuedAt: now,
      issuedByUserId: "user-1" as Id<"athenaUser">,
      commandContext: {
        reason: "Support requested app update.",
      },
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
      },
      kind: "user_error",
    });
    expect(repository.insertCommand).not.toHaveBeenCalled();
  });

  it("returns an equivalent active command instead of inserting duplicate work", async () => {
    const existingCommand = buildCommand({
      commandType: "repair_terminal_seed",
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      status: "claimed",
    });
    const repository = buildRepository({
      commands: [existingCommand],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        reason: "Terminal setup data needs repair.",
        expectedBlockerType: "terminal_seed",
      },
      storeId,
      terminalId,
    });

    expect(result).toEqual({
      kind: "ok",
      data: existingCommand,
    });
    expect(repository.insertCommand).not.toHaveBeenCalled();
  });

  it("returns an equivalent command waiting for runtime verification instead of inserting duplicate work", async () => {
    const existingCommand = buildCommand({
      commandType: "repair_terminal_seed",
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      status: "completed",
      verificationStatus: "runtime_verification_ready",
    });
    const repository = buildRepository({
      commands: [existingCommand],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        reason: "Terminal setup data needs repair.",
        expectedBlockerType: "terminal_seed",
      },
      storeId,
      terminalId,
    });

    expect(result).toEqual({
      kind: "ok",
      data: existingCommand,
    });
    expect(repository.insertCommand).not.toHaveBeenCalled();
  });

  it("replaces equivalent expired commands with fresh pending work", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expiresAt: now - 1,
          commandType: "clear_stale_drawer_authority",
          commandContext: {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
            reason: "Stale drawer authority blocks sales.",
          },
          expectedEvidence: {
            drawerAuthorityStatus: "healthy",
            localRegisterSessionId: "local-register-1",
          },
        }),
      ],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "clear_stale_drawer_authority",
      expectedEvidence: {
        drawerAuthorityStatus: "healthy",
        localRegisterSessionId: "local-register-1",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        localRegisterSessionId: "local-register-1",
        cloudRegisterSessionId: "cloud-register-1",
        reason: "Stale drawer authority blocks sales.",
      },
      storeId,
      terminalId,
    });

    expect(repository.patchCommand).not.toHaveBeenCalled();
    expect(repository.insertCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: "clear_stale_drawer_authority",
        status: "pending",
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "command-2",
        status: "pending",
      },
    });
  });

  it("replaces equivalent expired claimed commands with fresh pending work", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expiresAt: now - 1,
          commandType: "repair_terminal_seed",
          commandContext: {
            expectedBlockerType: "terminal_seed",
            reason: "Terminal setup data needs repair.",
          },
          expectedEvidence: {
            terminalIntegrityStatus: "healthy",
          },
          status: "claimed",
        }),
      ],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      storeId,
      terminalId,
    });

    expect(repository.patchCommand).not.toHaveBeenCalled();
    expect(repository.insertCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: "repair_terminal_seed",
        status: "pending",
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "command-2",
        status: "pending",
      },
    });
  });

  it("replaces equivalent expired commands that were waiting for runtime verification", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expiresAt: now - 1,
          commandType: "repair_terminal_seed",
          commandContext: {
            expectedBlockerType: "terminal_seed",
            reason: "Terminal setup data needs repair.",
          },
          expectedEvidence: {
            terminalIntegrityStatus: "healthy",
          },
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        }),
      ],
    });

    const result = await issueTerminalRecoveryCommand(repository, {
      commandType: "repair_terminal_seed",
      expectedEvidence: {
        terminalIntegrityStatus: "healthy",
      },
      issuedAt: now,
      issuedByUserId: "user-2" as Id<"athenaUser">,
      commandContext: {
        expectedBlockerType: "terminal_seed",
        reason: "Terminal setup data needs repair.",
      },
      storeId,
      terminalId,
    });

    expect(repository.patchCommand).not.toHaveBeenCalled();
    expect(repository.insertCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: "repair_terminal_seed",
        status: "pending",
      }),
    );
    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "command-2",
        status: "pending",
      },
    });
  });

  it("redacts and bounds acknowledgement messages before audit persistence", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          status: "claimed",
        }),
      ],
    });

    const result = await acknowledgeTerminalRecoveryCommand(repository, {
      acknowledgedAt: now,
      commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
      message: `staffProofToken=abc123 syncSecretHash=def456 paymentToken=ghi789 PIN 1234 payment=card customer Jane payload raw ${"a".repeat(40)} ${"details ".repeat(80)}`,
      result: "failed",
      storeId,
      terminalId,
    });

    expect(result.kind).toBe("ok");
    expect(repository.patchCommand).toHaveBeenCalledWith(
      "command-1",
      expect.objectContaining({
        acknowledgement: expect.objectContaining({
          message: expect.stringMatching(
            /^staffProofToken=\[redacted\] syncSecretHash=\[redacted\] paymentToken=\[redacted\] PIN \[redacted\] payment=\[redacted\] customer \[redacted\] payload \[redacted\] \[redacted\]/,
          ),
        }),
      }),
    );
    const patch = repository.patchCommand.mock.calls.at(-1)?.[1];
    expect(patch?.acknowledgement?.message).toHaveLength(240);
  });

  it("filters expired pending commands during listing and rejects expired claims", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expiresAt: now - 1,
        }),
      ],
    });

    await expect(
      listClaimableTerminalRecoveryCommands(repository, {
        now,
        storeId,
        terminalId,
      }),
    ).resolves.toEqual([]);
    expect(repository.patchCommand).not.toHaveBeenCalled();

    await expect(
      claimTerminalRecoveryCommand(repository, {
        claimedAt: now,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchCommand).toHaveBeenCalledWith("command-1", {
      status: "expired",
    });
  });

  it("filters expired pending and claimed commands through a read-only repository", async () => {
    const activeCommand = buildCommand({
      _id: "command-active" as Id<"posTerminalRecoveryCommand">,
    });
    const repository = {
      getCommand: vi.fn(),
      listCommandsForTerminal: vi.fn(async () => [
        buildCommand({
          _id: "command-expired-pending" as Id<"posTerminalRecoveryCommand">,
          expiresAt: now - 1,
          status: "pending",
        }),
        buildCommand({
          _id: "command-expired-claimed" as Id<"posTerminalRecoveryCommand">,
          expiresAt: now - 1,
          status: "claimed",
        }),
        activeCommand,
      ]),
    };

    await expect(
      listClaimableTerminalRecoveryCommands(repository, {
        now,
        storeId,
        terminalId,
      }),
    ).resolves.toEqual([activeCommand]);
    expect("patchCommand" in repository).toBe(false);
    expect("insertCommand" in repository).toBe(false);
  });

  it("rejects non-claimable and non-acknowledgeable command states", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          status: "completed",
          verificationStatus: "verified",
        }),
      ],
    });

    await expect(
      claimTerminalRecoveryCommand(repository, {
        claimedAt: now,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
        message: "This terminal recovery command is no longer claimable.",
      },
      kind: "user_error",
    });

    await expect(
      acknowledgeTerminalRecoveryCommand(repository, {
        acknowledgedAt: now,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        result: "completed",
        storeId,
        terminalId,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
        message: "This terminal recovery command cannot be acknowledged.",
      },
      kind: "user_error",
    });
  });

  it("does not let another terminal claim or acknowledge a command", async () => {
    const repository = buildRepository({
      commands: [buildCommand()],
    });

    await expect(
      listClaimableTerminalRecoveryCommands(repository, {
        now,
        storeId,
        terminalId: "terminal-2" as Id<"posTerminal">,
      }),
    ).resolves.toEqual([]);

    await expect(
      acknowledgeTerminalRecoveryCommand(repository, {
        acknowledgedAt: now,
        commandId: "command-1" as Id<"posTerminalRecoveryCommand">,
        result: "completed",
        storeId,
        terminalId: "terminal-2" as Id<"posTerminal">,
      }),
    ).resolves.toMatchObject({
      error: {
        code: "not_found",
      },
      kind: "user_error",
    });
  });

  it("verifies completed commands only after fresh matching runtime evidence", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expectedEvidence: {
            drawerAuthorityStatus: "healthy",
            localRegisterSessionId: "register-1",
          },
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        }),
      ],
    });

    const stale = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        drawerAuthority: {
          localRegisterSessionId: "register-1",
          observedAt: now - 30_000,
          status: "healthy",
        },
        receivedAt: now - 10 * 60 * 1000,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });
    expect(stale.verifiedCommandIds).toEqual([]);

    const fresh = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        drawerAuthority: {
          localRegisterSessionId: "register-1",
          observedAt: now,
          status: "healthy",
        },
        receivedAt: now,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });
    expect(fresh.verifiedCommandIds).toEqual(["command-1"]);
  });

  it("treats omitted optional terminal health sections as healthy during verification", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expectedEvidence: {
            drawerAuthorityStatus: "healthy",
            terminalIntegrityStatus: "healthy",
          },
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        }),
      ],
    });

    const result = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        drawerAuthority: undefined,
        receivedAt: now,
        terminalIntegrity: undefined,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });

    expect(result.verifiedCommandIds).toEqual(["command-1"]);
  });

  it("waits for post-apply runtime evidence before verifying app update commands", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          commandType: "update_app",
          expectedEvidence: {
            appUpdateCommandExecutionId: "execution-1",
          },
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        }),
      ],
    });

    const applying = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        appUpdate: {
          canApply: false,
          commandExecutionId: "execution-1",
          detectorStatus: "ok",
          observedAt: now,
          status: "applying",
        },
        receivedAt: now,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });
    expect(applying.verifiedCommandIds).toEqual([]);

    const current = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        appUpdate: {
          canApply: false,
          commandExecutionId: "execution-1",
          detectorStatus: "ok",
          observedAt: now,
          status: "current",
        },
        receivedAt: now,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });

    expect(current.verifiedCommandIds).toEqual(["command-1"]);
  });

  it("verifies cleared drawer authority when runtime omits the healthy drawer section", async () => {
    const repository = buildRepository({
      commands: [
        buildCommand({
          expectedEvidence: {
            drawerAuthorityStatus: "healthy",
            localRegisterSessionId: "register-1",
          },
          status: "completed",
          verificationStatus: "runtime_verification_ready",
        }),
      ],
    });

    const result = await verifyTerminalRecoveryCommandsFromRuntime(repository, {
      runtimeStatus: buildRuntimeStatus({
        drawerAuthority: undefined,
        receivedAt: now,
      }),
      storeId,
      terminalId,
      verifiedAt: now,
    });

    expect(result.verifiedCommandIds).toEqual(["command-1"]);
  });
});

function buildRepository(seed: {
  commands?: Doc<"posTerminalRecoveryCommand">[];
} = {}) {
  const commands = [...(seed.commands ?? [])];
  return {
    getCommand: vi.fn(async (commandId: Id<"posTerminalRecoveryCommand">) => {
      return commands.find((command) => command._id === commandId) ?? null;
    }),
    insertCommand: vi.fn(
      async (input: Omit<Doc<"posTerminalRecoveryCommand">, "_id" | "_creationTime">) => {
        const commandId = `command-${commands.length + 1}` as Id<"posTerminalRecoveryCommand">;
        const command = {
          _id: commandId,
          _creationTime: input.issuedAt,
          ...input,
        };
        commands.push(command);
        return command._id;
      },
    ),
    listCommandsForTerminal: vi.fn(async (args) =>
      commands.filter((command) => {
        if (command.storeId !== args.storeId || command.terminalId !== args.terminalId) {
          return false;
        }
        if (
          args.statuses !== undefined &&
          !args.statuses.includes(command.status)
        ) {
          return false;
        }
        if (
          args.expiresAfter !== undefined &&
          command.expiresAt <= args.expiresAfter
        ) {
          return false;
        }
        return true;
      }),
    ),
    patchCommand: vi.fn(
      async (
        commandId: Id<"posTerminalRecoveryCommand">,
        patch: Partial<Doc<"posTerminalRecoveryCommand">>,
      ) => {
        const index = commands.findIndex((command) => command._id === commandId);
        if (index >= 0) {
          commands[index] = { ...commands[index]!, ...patch };
        }
      },
    ),
  };
}

function buildCommand(
  overrides: Partial<Doc<"posTerminalRecoveryCommand">> = {},
): Doc<"posTerminalRecoveryCommand"> {
  return {
    _id: "command-1" as Id<"posTerminalRecoveryCommand">,
    _creationTime: now,
    acknowledgement: undefined,
    claimedAt: undefined,
    commandType: "retry_sync",
    expiresAt: now + 10 * 60 * 1000,
    expectedEvidence: {},
    issuedAt: now,
    issuedByUserId: "user-1" as Id<"athenaUser">,
    commandContext: {
      reason: "Support requested sync retry.",
    },
    status: "pending",
    storeId,
    terminalId,
    verificationStatus: "waiting_for_acknowledgement",
    ...overrides,
  } as Doc<"posTerminalRecoveryCommand">;
}

function buildRuntimeStatus(
  overrides: Partial<Doc<"posTerminalRuntimeStatus">> = {},
): Doc<"posTerminalRuntimeStatus"> {
  return {
    _id: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: now,
    localStore: {
      available: true,
      terminalSeedReady: true,
    },
    receivedAt: now,
    reportedAt: now,
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
    ...overrides,
  } as Doc<"posTerminalRuntimeStatus">;
}
