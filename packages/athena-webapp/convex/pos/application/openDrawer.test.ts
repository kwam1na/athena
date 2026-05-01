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

const terminal = {
  _id: "terminal-1" as Id<"posTerminal">,
  storeId: "store-1" as Id<"store">,
  registerNumber: "A1",
};

const activeStaffProfile = {
  _id: "staff-1" as Id<"staffProfile">,
  storeId: "store-1" as Id<"store">,
  status: "active",
};
const managerRoleAssignment = {
  _id: "role-1",
  role: "manager",
  staffProfileId: "staff-1" as Id<"staffProfile">,
  status: "active",
  storeId: "store-1" as Id<"store">,
};

function createDbGetMock({
  terminalOverride,
  staffProfileOverride,
}: {
  terminalOverride?: Partial<typeof terminal>;
  staffProfileOverride?: Partial<typeof activeStaffProfile> | null;
} = {}) {
  const resolvedTerminal = { ...terminal, ...terminalOverride };
  const resolvedStaffProfile =
    staffProfileOverride === null
      ? null
      : { ...activeStaffProfile, ...staffProfileOverride };

  return vi.fn(
    async (
      tableNameOrId:
        | "posTerminal"
        | "staffProfile"
        | Id<"posTerminal">
        | Id<"staffProfile">,
      maybeId?: Id<"posTerminal"> | Id<"staffProfile">,
    ) => {
      const tableName =
        tableNameOrId === "posTerminal" || tableNameOrId === "staffProfile"
          ? tableNameOrId
          : tableNameOrId === "staff-1" || maybeId === "staff-1"
            ? "staffProfile"
            : "posTerminal";
      return tableName === "staffProfile"
        ? resolvedStaffProfile
        : resolvedTerminal;
    },
  );
}

function createDbQueryMock({
  roleAssignments = [managerRoleAssignment],
}: {
  roleAssignments?: Array<Partial<typeof managerRoleAssignment>>;
} = {}) {
  return vi.fn((tableName: string) => {
    if (tableName !== "staffRoleAssignment") {
      throw new Error(`Unexpected query table: ${tableName}`);
    }

    return {
      withIndex: vi.fn((_indexName: string, buildQuery) => {
        const q = {
          eq: vi.fn(() => q),
        };
        buildQuery(q);

        return {
          take: vi.fn(async () => roleAssignments),
        };
      }),
    };
  });
}

function createDbMock(
  options: Parameters<typeof createDbGetMock>[0] & {
    roleAssignments?: Array<Partial<typeof managerRoleAssignment>>;
  } = {},
) {
  return {
    get: createDbGetMock(options),
    query: createDbQueryMock({
      roleAssignments: options.roleAssignments,
    }),
  };
}

describe("openDrawer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("opens a register session with the authenticated Athena user and signed-in staff member", async () => {
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
      db: createDbMock(),
    } as unknown as MutationCtx;

    const result = await openDrawer(ctx, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
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
        openedByStaffProfileId: "staff-1",
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
      db: createDbMock({
        terminalOverride: { registerNumber: "B2" },
      }),
    } as unknown as MutationCtx;

    const result = await openDrawer(ctx, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      openingFloat: 5000,
      notes: "Terminal based register number",
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        organizationId: "org-1",
        openedByStaffProfileId: "staff-1",
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
      db: { get: vi.fn(), query: vi.fn() },
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
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

  it("requires a manager role before opening a drawer", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "user-1" as Id<"athenaUser">,
    });

    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        _id: "store-1" as Id<"store">,
        organizationId: "org-1" as Id<"organization">,
      }),
      db: createDbMock({
        roleAssignments: [
          {
            ...managerRoleAssignment,
            role: "cashier",
          },
        ],
      }),
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
        openingFloat: 5000,
      }),
    ).resolves.toEqual(
      userError({
        code: "authorization_failed",
        message: "Manager sign-in required to open this drawer.",
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
      db: createDbMock(),
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
        staffProfileId: "staff-1" as Id<"staffProfile">,
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
      db: createDbMock(),
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
        staffProfileId: "staff-1" as Id<"staffProfile">,
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
      db: createDbMock({
        terminalOverride: { registerNumber: "B1" },
      }),
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
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
      db: createDbMock({
        terminalOverride: { registerNumber: undefined },
      }),
      runMutation: vi.fn(),
    } as unknown as MutationCtx;

    await expect(
      openDrawer(ctx, {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        staffProfileId: "staff-1" as Id<"staffProfile">,
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
