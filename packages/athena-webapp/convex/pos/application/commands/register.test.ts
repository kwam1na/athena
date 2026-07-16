import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

import { openDrawer } from "./register";

const OPEN_REGISTER_SESSION = {
  _id: "register-session-1",
  status: "active" as const,
  terminalId: "terminal-1",
  registerNumber: "1",
  openingFloat: 100,
  expectedCash: 100,
  openedAt: 1_000,
};

function buildCtx(
  overrides: {
    store?: Record<string, unknown> | null;
    terminal?: Record<string, unknown> | null;
    staffProfile?: Record<string, unknown> | null;
    roleAssignments?: Array<Record<string, unknown>>;
  } = {},
) {
  const runMutation = vi.fn(async () => OPEN_REGISTER_SESSION);
  const runQuery = vi.fn(async () =>
    Object.prototype.hasOwnProperty.call(overrides, "store")
      ? overrides.store
      : { _id: "store-1", organizationId: "org-1" },
  );
  return {
    runMutation,
    runQuery,
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "posTerminal" && id === "terminal-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "terminal")
            ? overrides.terminal
            : {
                _id: "terminal-1",
                storeId: "store-1",
                registerNumber: "1",
                status: "active",
              };
        }
        if (tableName === "staffProfile" && id === "staff-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "staffProfile")
            ? overrides.staffProfile
            : { _id: "staff-1", storeId: "store-1", status: "active" };
        }
        return null;
      }),
      query: vi.fn(() => ({
        withIndex: () => ({
          take: async () =>
            overrides.roleAssignments ?? [
              {
                staffProfileId: "staff-1",
                storeId: "store-1",
                status: "active",
                role: "cashier",
              },
            ],
        }),
      })),
    },
  };
}

const baseArgs = {
  storeId: "store-1" as never,
  terminalId: "terminal-1" as never,
  staffProfileId: "staff-1" as never,
  registerNumber: "1",
  openingFloat: 100,
};

describe("openDrawer command authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "pos_only",
    });
  });

  it("opens the drawer for a same-org member", async () => {
    const ctx = buildCtx();

    const result = await openDrawer(ctx as never, baseArgs);

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ kind: "ok" }));
  });

  it("denies a foreign-org user opening a drawer and never opens a register session", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot open a register drawer for this store."),
    );
    const ctx = buildCtx();

    await expect(openDrawer(ctx as never, baseArgs)).rejects.toThrow(
      "You cannot open a register drawer for this store.",
    );
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller opening a drawer", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(openDrawer(ctx as never, baseArgs)).rejects.toThrow(
      "Sign in again to continue.",
    );
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("returns a clean not-found for a non-existent store without membership checks", async () => {
    const ctx = buildCtx({ store: null });

    const result = await openDrawer(ctx as never, baseArgs);

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({ code: "not_found" }),
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
