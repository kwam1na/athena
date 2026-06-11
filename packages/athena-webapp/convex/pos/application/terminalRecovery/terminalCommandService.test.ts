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
    const patch = vi.mocked(repository.patchCommand).mock.calls.at(-1)?.[1];
    expect(patch?.acknowledgement?.message).toHaveLength(240);
  });

  it("expires pending commands during listing and rejects expired claims", async () => {
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
    expect(repository.patchCommand).toHaveBeenCalledWith("command-1", {
      status: "expired",
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
      },
      kind: "user_error",
    });
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
        const command = {
          _id: "command-1" as Id<"posTerminalRecoveryCommand">,
          _creationTime: input.issuedAt,
          ...input,
        };
        commands.push(command);
        return command._id;
      },
    ),
    listCommandsForTerminal: vi.fn(async () => commands),
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
