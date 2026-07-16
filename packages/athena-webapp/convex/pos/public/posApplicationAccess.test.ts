import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPosApplicationAccessStatus: vi.fn(),
  recordOperationalEventWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  setPosApplicationAccess: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: mocks.recordOperationalEventWithCtx,
}));

vi.mock("../../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable:
    mocks.requireSharedDemoStoreCapabilityIfApplicable,
}));

vi.mock("../application/posServicePrincipal", () => ({
  getPosApplicationAccessStatus: mocks.getPosApplicationAccessStatus,
  setPosApplicationAccess: mocks.setPosApplicationAccess,
}));

import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import {
  enableApplicationAccess,
  getApplicationAccessStatus,
  revokeApplicationAccess,
} from "./posApplicationAccess";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function buildCtx() {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) =>
        tableName === "store" && id === "store-1"
          ? { _id: "store-1", name: "Downtown", organizationId: "org-1" }
          : null,
      ),
    },
  };
}

describe("POS application-access public adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "admin-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "full_admin",
    });
    mocks.requireSharedDemoStoreCapabilityIfApplicable.mockResolvedValue(null);
    mocks.getPosApplicationAccessStatus.mockResolvedValue({
      grantId: "grant-1",
      grantRevision: 4,
      principalStatus: "active",
      servicePrincipalId: "principal-1",
      status: "enabled",
    });
    mocks.setPosApplicationAccess.mockImplementation(async (_ctx, args) => ({
      grantId: "grant-1",
      grantRevision: args.expectedRevision + 1,
      principalStatus: "active",
      servicePrincipalId: "principal-1",
      status: args.enabled ? "enabled" : "revoked",
    }));
    mocks.recordOperationalEventWithCtx.mockResolvedValue({ _id: "event-1" });
  });

  it("returns same-store status only after full-admin authorization", async () => {
    const ctx = buildCtx();

    await expect(
      getHandler(getApplicationAccessStatus)(ctx as never, {
        storeId: "store-1",
      }),
    ).resolves.toMatchObject({ grantRevision: 4, status: "enabled" });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "admin-1",
      }),
    );
    expect(mocks.getPosApplicationAccessStatus).toHaveBeenCalledWith(ctx, {
      organizationId: "org-1",
      storeId: "store-1",
    });
  });

  it("keeps representative handler results inside the exported return contracts", async () => {
    const ctx = buildCtx();
    const status = await getHandler(getApplicationAccessStatus)(ctx as never, {
      storeId: "store-1",
    });
    const enabled = await getHandler(enableApplicationAccess)(ctx as never, {
      expectedRevision: 4,
      storeId: "store-1",
    });
    const revoked = await getHandler(revokeApplicationAccess)(ctx as never, {
      expectedRevision: 4,
      storeId: "store-1",
    });

    assertConformsToExportedReturns(getApplicationAccessStatus, status);
    assertConformsToExportedReturns(enableApplicationAccess, enabled);
    assertConformsToExportedReturns(revokeApplicationAccess, revoked);
  });

  it.each([
    ["enable", enableApplicationAccess, true],
    ["revoke", revokeApplicationAccess, false],
  ] as const)(
    "applies expected-revision %s and records human audit evidence",
    async (_label, definition, enabled) => {
      const ctx = buildCtx();

      await expect(
        getHandler(definition)(ctx as never, {
          expectedRevision: 4,
          storeId: "store-1",
        }),
      ).resolves.toMatchObject({
        grantRevision: 5,
        status: enabled ? "enabled" : "revoked",
      });

      expect(mocks.setPosApplicationAccess).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          enabled,
          expectedRevision: 4,
          organizationId: "org-1",
          storeId: "store-1",
        }),
      );
      expect(mocks.recordOperationalEventWithCtx).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          actorType: "human",
          actorUserId: "admin-1",
          servicePrincipalId: "principal-1",
          storeId: "store-1",
        }),
      );
    },
  );

  it("denies non-full-admin actors before reading or changing authority", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("Only full admins can manage POS application access."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(getApplicationAccessStatus)(ctx as never, {
        storeId: "store-1",
      }),
    ).rejects.toThrow("Only full admins");
    expect(mocks.getPosApplicationAccessStatus).not.toHaveBeenCalled();
    expect(mocks.setPosApplicationAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["enable", enableApplicationAccess],
    ["revoke", revokeApplicationAccess],
  ] as const)(
    "denies shared-demo access before the %s authority write",
    async (_label, definition) => {
      const denial = new Error("This action is unavailable in the demo.");
      mocks.requireSharedDemoStoreCapabilityIfApplicable.mockRejectedValue(
        denial,
      );
      const ctx = buildCtx();

      await expect(
        getHandler(definition)(ctx as never, {
          expectedRevision: 4,
          storeId: "store-1",
        }),
      ).rejects.toThrow(denial.message);

      expect(
        mocks.requireSharedDemoStoreCapabilityIfApplicable,
      ).toHaveBeenCalledWith(ctx, "pos.terminal.manage", "store-1");
      expect(ctx.db.get).not.toHaveBeenCalled();
      expect(mocks.setPosApplicationAccess).not.toHaveBeenCalled();
    },
  );
});
