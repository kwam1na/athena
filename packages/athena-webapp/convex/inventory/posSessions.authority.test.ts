import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePosApplicationAuthorityWithCtx: vi.fn(),
  runStartSessionCommand: vi.fn(),
}));

vi.mock("../pos/application/posApplicationAuthority", () => ({
  requirePosApplicationAuthorityWithCtx:
    mocks.requirePosApplicationAuthorityWithCtx,
}));
vi.mock("../pos/application/commands/sessionCommands", () => ({
  runBindSessionToRegisterSessionCommand: vi.fn(),
  runHoldSessionCommand: vi.fn(),
  runResumeSessionCommand: vi.fn(),
  runStartSessionCommand: mocks.runStartSessionCommand,
}));

import { createSession, getSessionById } from "./posSessions";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS session application authority", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    mocks.runStartSessionCommand.mockResolvedValue({
      status: "ok",
      data: { expiresAt: 10_000, sessionId: "session-1" },
    });
  });

  it("allows a same-store, same-terminal application session", async () => {
    const ctx = buildCtx();
    const result = await getHandler(createSession)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
    });

    expect(result.kind).toBe("ok");
    expect(mocks.requirePosApplicationAuthorityWithCtx).toHaveBeenCalledWith(
      ctx,
      { storeId: "store-1" },
    );
    expect(mocks.runStartSessionCommand).toHaveBeenCalledTimes(1);
  });

  it("denies cross-terminal scope before command execution", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-2",
    });

    await expect(
      getHandler(createSession)(buildCtx() as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("no longer authorized");
    expect(mocks.runStartSessionCommand).not.toHaveBeenCalled();
  });

  it("denies revoked authority and never falls through to a human actor", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockRejectedValue(
      new Error("The POS application session is no longer authorized."),
    );

    await expect(
      getHandler(createSession)(buildCtx() as never, {
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).rejects.toThrow("no longer authorized");
    expect(mocks.runStartSessionCommand).not.toHaveBeenCalled();
  });

  it("denies a session resource owned by another terminal", async () => {
    mocks.requirePosApplicationAuthorityWithCtx.mockResolvedValue({
      storeId: "store-1",
      terminalId: "terminal-2",
    });

    await expect(
      getHandler(getSessionById)(buildCtx() as never, {
        sessionId: "session-1",
      }),
    ).rejects.toThrow("no longer authorized");
  });
});

function buildCtx() {
  return {
    db: {
      get: vi.fn(async (table: string, id: string) =>
        table === "posSession" && id === "session-1"
          ? {
              _id: "session-1",
              storeId: "store-1",
              terminalId: "terminal-1",
            }
          : null,
      ),
    },
  };
}
