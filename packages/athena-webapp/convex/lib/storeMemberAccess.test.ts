import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sharedDemo/actor", () => ({
  requireSharedDemoStoreCapabilityIfApplicable: vi.fn(),
  requireSharedDemoStoreReadIfApplicable: vi.fn(),
}));
vi.mock("./athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

import {
  requireSharedDemoStoreCapabilityIfApplicable,
  requireSharedDemoStoreReadIfApplicable,
} from "../sharedDemo/actor";
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

  it("resolves demo identity only after read-store clamping", async () => {
    vi.mocked(requireSharedDemoStoreReadIfApplicable).mockResolvedValue({
      athenaUserId: "athena-user-1",
      kind: "shared_demo",
      storeId: "store-1",
    } as never);
    const store = { _id: "store-1", organizationId: "org-1" };
    const demoUser = { _id: "athena-user-1" };
    const ctx = {
      db: {
        get: vi.fn(async (_table: string, id: string) =>
          id === "athena-user-1" ? demoUser : store,
        ),
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

    expect(requireSharedDemoStoreReadIfApplicable).toHaveBeenCalledWith(
      ctx,
      "store-1",
    );
    expect(requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "Access denied.",
      organizationId: "org-1",
      userId: "athena-user-1",
    });
  });

  it("requires an allowed capability before resolving demo identity for writes", async () => {
    vi.mocked(requireSharedDemoStoreCapabilityIfApplicable).mockResolvedValue({
      athenaUserId: "athena-user-1",
      kind: "shared_demo",
      storeId: "store-1",
    } as never);
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

    expect(requireSharedDemoStoreCapabilityIfApplicable).toHaveBeenCalledWith(
      ctx,
      "daily_operations.write",
      "store-1",
    );
  });

  it("preserves ordinary Athena authentication when no demo actor is present", async () => {
    vi.mocked(requireSharedDemoStoreReadIfApplicable).mockResolvedValue(null);
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
