import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../shared/auth";

const providerMocks = vi.hoisted(() => ({
  ConvexCredentials: vi.fn((config) => config),
}));

vi.mock("@convex-dev/auth/providers/ConvexCredentials", () => ({
  ConvexCredentials: providerMocks.ConvexCredentials,
}));

import { PosRecoveryCode } from "./PosRecoveryCode";

const AUTH_USER_ID = "auth-user-pos" as Id<"users">;

describe("PosRecoveryCode auth provider", () => {
  it("registers the Athena POS recovery-code provider id", () => {
    expect(PosRecoveryCode.id).toBe(ATHENA_POS_RECOVERY_CODE_PROVIDER_ID);
  });

  it("returns null when required credentials or store scope are missing", async () => {
    const ctx = { runMutation: vi.fn() };

    await expect(
      PosRecoveryCode.authorize(
        { code: "abc-123", email: "pos@wigclub.store" },
        ctx as never,
      ),
    ).resolves.toBeNull();
    await expect(
      PosRecoveryCode.authorize(
        {
          email: "pos@wigclub.store",
          orgUrlSlug: "wigclub",
          storeUrlSlug: "wigclub",
        },
        ctx as never,
      ),
    ).resolves.toBeNull();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("maps successful internal verification to Convex Auth user identity", async () => {
    const ctx = {
      runMutation: vi.fn(async () => ({ authUserId: AUTH_USER_ID })),
    };

    await expect(
      PosRecoveryCode.authorize(
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          orgUrlSlug: "wigclub",
          storeUrlSlug: "wigclub",
        },
        ctx as never,
      ),
    ).resolves.toEqual({ userId: AUTH_USER_ID });
    expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), {
      code: "abc-123",
      email: "pos@wigclub.store",
      orgUrlSlug: "wigclub",
      storeId: undefined,
      storeUrlSlug: "wigclub",
    });
  });

  it("returns null when internal verification rejects", async () => {
    const ctx = {
      runMutation: vi.fn(async () => {
        throw new Error("POS recovery sign-in failed.");
      }),
    };

    await expect(
      PosRecoveryCode.authorize(
        {
          code: "abc-123",
          email: "pos@wigclub.store",
          storeId: "store-1",
        },
        ctx as never,
      ),
    ).resolves.toBeNull();
  });
});
