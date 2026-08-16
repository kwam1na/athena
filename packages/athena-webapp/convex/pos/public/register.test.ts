import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireStoreMemberAccessWithCtx: vi.fn(),
  getRegisterState: vi.fn(),
  openDrawerCommand: vi.fn(),
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

vi.mock("../../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: mocks.requireReadySharedDemoWriteWithCtx,
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../../lib/storeMemberAccess", () => ({
  requireStoreMemberAccessWithCtx: mocks.requireStoreMemberAccessWithCtx,
}));

vi.mock("../../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
}));

vi.mock("../application/queries/getRegisterState", () => ({
  getRegisterState: mocks.getRegisterState,
}));

vi.mock("../application/commands/register", () => ({
  openDrawer: mocks.openDrawerCommand,
}));

import { AthenaUnauthenticatedError } from "../../lib/athenaUnauthenticated";
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
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "pos_only",
    });
    mocks.requireStoreMemberAccessWithCtx.mockImplementation(
      async (ctx, args) => {
        const athenaUser =
          await mocks.requireAuthenticatedAthenaUserWithCtx(ctx);
        const membership = await mocks.requireOrganizationMemberRoleWithCtx(
          ctx,
          {
            allowedRoles: args.allowedRoles,
            failureMessage: args.failureMessage,
            organizationId: "org-1",
            userId: athenaUser._id,
          },
        );
        return { athenaUser, membership, store: { _id: args.storeId } };
      },
    );
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

  it("admits shared-demo register state through the read rail", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      storeId: "store-1",
    });
    mocks.getRegisterState.mockResolvedValue({ phase: "ready" });
    const ctx = buildCtx();

    const result = await getHandler(getState)(ctx as never, {
      storeId: "store-1",
    });

    expect(result).toEqual({ phase: "ready" });
    expect(mocks.getSharedDemoActorWithCtx).toHaveBeenCalledWith(ctx);
    expect(mocks.requireStoreMemberAccessWithCtx).toHaveBeenCalledWith(
      expect.objectContaining({
        operationAdmission: expect.objectContaining({
          actor: expect.objectContaining({
            athenaUserId: "demo-user-1",
            kind: "shared_demo",
          }),
        }),
      }),
      expect.objectContaining({ storeId: "store-1" }),
    );
  });

  it("denies shared-demo register state outside the admitted store", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      storeId: "other-store",
    });
    const ctx = buildCtx();

    await expect(
      getHandler(getState)(ctx as never, { storeId: "store-1" }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(mocks.getRegisterState).not.toHaveBeenCalled();
  });

  it("returns null without leaking state for a non-existent store", async () => {
    const ctx = buildCtx({ store: null });

    const result = await getHandler(getState)(ctx as never, {
      storeId: "store-1",
    });

    expect(result).toBeNull();
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledTimes(
      1,
    );
    expect(mocks.requireStoreMemberAccessWithCtx).not.toHaveBeenCalled();
    expect(mocks.getRegisterState).not.toHaveBeenCalled();
  });
});

describe("pos public register.openDrawer admission", () => {
  const openDrawerArgs = {
    openingFloat: 100,
    staffProfileId: "staff-1",
    storeId: "store-1",
    terminalId: "terminal-1",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireReadySharedDemoWriteWithCtx.mockResolvedValue(undefined);
    mocks.openDrawerCommand.mockResolvedValue({ kind: "ok", data: null });
  });

  it("runs the command for an admitted normal user", async () => {
    const ctx = buildCtx();

    const result = await getHandler(openDrawer)(ctx as never, openDrawerArgs);

    expect(result).toEqual({ kind: "ok", data: null });
    expect(mocks.openDrawerCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        operationAdmission: expect.objectContaining({
          actor: expect.objectContaining({ kind: "normal_user" }),
        }),
      }),
      openDrawerArgs,
    );
  });

  it("denies an unauthenticated caller before the command runs", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError(),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(openDrawer)(ctx as never, openDrawerArgs),
    ).rejects.toThrow("Sign in again to continue.");
    expect(mocks.openDrawerCommand).not.toHaveBeenCalled();
  });

  it("admits shared demo behind the restore fence for its own store", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });
    const ctx = buildCtx();

    await getHandler(openDrawer)(ctx as never, openDrawerArgs);

    // `cash.control.write` is a demo grant, so the fence — not the capability —
    // is what stands between a demo visitor and this write.
    expect(mocks.requireReadySharedDemoWriteWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeId: "store-1" }),
    );
    expect(mocks.openDrawerCommand).toHaveBeenCalled();
  });

  it("denies shared demo opening a drawer in another store", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "other-store",
    });
    const ctx = buildCtx();

    await expect(
      getHandler(openDrawer)(ctx as never, openDrawerArgs),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(mocks.openDrawerCommand).not.toHaveBeenCalled();
  });

  it("denies shared demo while the store is restoring", async () => {
    mocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      organizationId: "org-1",
      storeId: "store-1",
    });
    mocks.requireReadySharedDemoWriteWithCtx.mockRejectedValue(
      new Error("The demo is being restored. Try again shortly."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(openDrawer)(ctx as never, openDrawerArgs),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(mocks.openDrawerCommand).not.toHaveBeenCalled();
  });
});
