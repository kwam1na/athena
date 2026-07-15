import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  getRegisterState: vi.fn(),
  openDrawerCommand: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/queries/getRegisterState", () => ({
  getRegisterState: mocks.getRegisterState,
}));

vi.mock("../application/commands/register", () => ({
  openDrawer: mocks.openDrawerCommand,
}));

import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import { getState, openDrawer } from "./register";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function buildCtx(
  overrides: {
    store?: Record<string, unknown> | null;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "store")
            ? overrides.store
            : { _id: "store-1", organizationId: "org-1" };
        }
        return null;
      }),
    },
  };
}

describe("pos public register contracts", () => {
  it("accepts review-only closeout register-session statuses in command results", () => {
    assertConformsToExportedReturns(openDrawer as never, {
      kind: "ok",
      data: {
        _id: "register-session-1",
        status: "closeout_rejected",
        terminalId: "terminal-1",
        registerNumber: "8",
        openingFloat: 100,
        expectedCash: 100,
        openedAt: 1_000,
        notes: "Manager rejected variance closeout.",
        workflowTraceId: "trace-register-session-1",
      },
    });
  });
});

describe("pos public register.getState authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "pos_only",
    });
    mocks.getRegisterState.mockResolvedValue({ phase: "ready" });
  });

  it("reads register state for a same-org member", async () => {
    const ctx = buildCtx();

    const result = await getHandler(getState)(ctx as never, {
      storeId: "store-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getRegisterState).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
    expect(result).toEqual({ phase: "ready" });
  });

  it("denies a foreign-org user reading another store's register state", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot view register state for this store."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(getState)(ctx as never, { storeId: "store-1" }),
    ).rejects.toThrow("You cannot view register state for this store.");
    expect(mocks.getRegisterState).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller reading register state", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(getState)(ctx as never, { storeId: "store-1" }),
    ).rejects.toThrow("Sign in again to continue.");
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.getRegisterState).not.toHaveBeenCalled();
  });

  it("returns null without leaking state for a non-existent store", async () => {
    const ctx = buildCtx({ store: null });

    const result = await getHandler(getState)(ctx as never, {
      storeId: "store-1",
    });

    expect(result).toBeNull();
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(mocks.getRegisterState).not.toHaveBeenCalled();
  });
});
