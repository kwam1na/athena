import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
}));
vi.mock("./athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

import { requireSharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "./athenaUserAuth";
import { requireStoreMemberAccessWithCtx } from "./storeMemberAccess";

describe("store member access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
      _id: "athena-user-1",
    } as never);
    vi.mocked(requireOrganizationMemberRoleWithCtx).mockResolvedValue({
      role: "full_admin",
    } as never);
  });

  it("resolves shared-demo identity from operation admission", async () => {
    const store = { _id: "store-1", organizationId: "org-1" };
    const demoUser = { _id: "athena-user-1" };
    const ctx = {
      db: {
        get: vi.fn(async (_table: string, id: string) =>
          id === "athena-user-1" ? demoUser : store,
        ),
      },
      operationAdmission: {
        actor: {
          athenaUserId: "athena-user-1",
          kind: "shared_demo",
          storeId: "store-1",
        },
      },
    } as never;

    await expect(
      requireStoreMemberAccessWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "Access denied.",
        demoAccess: { kind: "read" },
        storeId: "store-1" as never,
      }),
    ).resolves.toMatchObject({ athenaUser: { _id: "athena-user-1" }, store });

    expect(requireSharedDemoStoreCapabilityIfApplicable).not.toHaveBeenCalled();
    expect(requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
    expect(requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "Access denied.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });

  it("ignores legacy demo access options when no operation admission exists", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (_table: string, id: string) =>
          id === "athena-user-1"
            ? { _id: "athena-user-1" }
            : { _id: "store-1", organizationId: "org-1" },
        ),
      },
    } as never;

    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      demoAccess: {
        capability: "daily_operations.write",
        kind: "capability",
      },
      failureMessage: "Access denied.",
      storeId: "store-1" as never,
    });

    expect(requireSharedDemoStoreCapabilityIfApplicable).not.toHaveBeenCalled();
    expect(requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
  });

  it("preserves ordinary Athena authentication when no admitted demo actor is present", async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "store-1",
          organizationId: "org-1",
        }),
      },
      operationAdmission: {
        actor: {
          athenaUserId: "athena-user-1",
          kind: "normal_user",
        },
      },
    } as never;

    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Access denied.",
      demoAccess: { kind: "read" },
      storeId: "store-1" as never,
    });

    expect(requireSharedDemoStoreCapabilityIfApplicable).not.toHaveBeenCalled();
    expect(requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(
      expect.objectContaining({
        operationAdmission: expect.objectContaining({
          actor: expect.objectContaining({ kind: "normal_user" }),
        }),
      }),
    );
  });

  it("preserves ordinary Athena authentication when no operation admission is present", async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "store-1",
          organizationId: "org-1",
        }),
      },
    } as never;

    await requireStoreMemberAccessWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "Access denied.",
      demoAccess: { kind: "read" },
      storeId: "store-1" as never,
    });

    expect(requireAuthenticatedAthenaUserWithCtx).toHaveBeenCalledWith(ctx);
  });
});
