import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ok, userError } from "../../../shared/commandResult";
import { openDrawer } from "./commands/register";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    authMocks.requireAuthenticatedAthenaUserWithCtx,
}));

describe("openDrawer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("opens a register session with the authenticated Athena user and maps the result", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      runMutation: vi.fn().mockResolvedValue({
        _id: "drawer-1" as Id<"registerSession">,
        expectedCash: 7500,
        openedAt: 1710000000000,
        openingFloat: 5000,
        registerNumber: "A1",
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        workflowTraceId: "register_session:a1",
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: "A1",
        }),
      },
    } as unknown as MutationCtx;

    const result = await openDrawer(ctx, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      registerNumber: "A1",
      openingFloat: 5000,
      notes: "Opening float ready",
    });

    expect(authMocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      ctx,
    );
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        organizationId: "org-1",
        openedByUserId: "user-1",
        openingFloat: 5000,
        registerNumber: "A1",
        terminalId: "terminal-1",
        notes: "Opening float ready",
      }),
    );
    expect(result).toEqual(
      ok({
        _id: "drawer-1" as Id<"registerSession">,
        expectedCash: 7500,
        openedAt: 1710000000000,
        openingFloat: 5000,
        registerNumber: "A1",
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        workflowTraceId: "register_session:a1",
      }),
    );
  });

  it("uses the terminal register number when no register number is provided", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      runMutation: vi.fn().mockResolvedValue({
        _id: "drawer-2" as Id<"registerSession">,
        expectedCash: 5000,
        openedAt: 1710000000000,
        openingFloat: 5000,
        registerNumber: "B2",
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        workflowTraceId: "register_session:b2",
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: "B2",
        }),
      },
    } as unknown as MutationCtx;

    const result = await openDrawer(ctx, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      openingFloat: 5000,
      notes: "Terminal based register number",
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        organizationId: "org-1",
        registerNumber: "B2",
      }),
    );
    expect(result).toEqual(
      ok({
        _id: "drawer-2" as Id<"registerSession">,
        expectedCash: 5000,
        openedAt: 1710000000000,
        openingFloat: 5000,
        registerNumber: "B2",
        status: "open",
        terminalId: "terminal-1" as Id<"posTerminal">,
        workflowTraceId: "register_session:b2",
      }),
    );
  });

  it("returns a not_found user_error when the store does not exist", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
      db: { get: vi.fn() },
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "not_found",
        message: "Store not found.",
      }),
    );

    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("returns a conflict user_error for duplicate-drawer rejections", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: "A1",
        }),
      },
      runMutation: vi
        .fn()
        .mockRejectedValue(
          new Error("A register session is already open for this terminal."),
        ),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "conflict",
        message: "A register session is already open for this terminal.",
      }),
    );
  });

  it("returns a conflict user_error for duplicate register-number rejections", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: "A1",
        }),
      },
      runMutation: vi
        .fn()
        .mockRejectedValue(
          new Error("A register session is already open for this register number."),
        ),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerNumber: "A1",
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "conflict",
        message: "A register session is already open for this register number.",
      }),
    );
  });

  it("returns a validation_failed user_error when terminal registerNumber differs", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: "B1",
        }),
      },
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerNumber: "A1",
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "validation_failed",
        message: "The terminal is configured with a different register number.",
      }),
    );
  });

  it("returns a validation_failed user_error when terminal is missing a register number", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "terminal-1" as Id<"posTerminal">,
          storeId: "store-1" as Id<"store">,
          registerNumber: undefined,
        }),
      },
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        registerNumber: "A1",
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "validation_failed",
        message: "This terminal is not configured with a register number.",
      }),
    );
  });
});
