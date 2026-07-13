import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSharedDemoActorWithCtx,
  requireSharedDemoCapabilityIfApplicable,
} from "./actor";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

import { getAuthUserId } from "@convex-dev/auth/server";

describe("shared demo actor resolution", () => {
  beforeEach(() => {
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("ATHENA_DEPLOYMENT_ENVIRONMENT", "qa");
    vi.stubEnv("ATHENA_DEPLOYMENT_ID", "qa-1");
    vi.stubEnv("ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST", "qa-1");
  });
  it("resolves the server-owned demo store while admission is active", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const unique = vi.fn().mockResolvedValue({
      admissionExpiresAt: 20_000,
      athenaUserId: "athena-user",
      authUserId: "auth-user",
      organizationId: "organization",
      storeId: "store",
    });
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn((_name, apply) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return { unique };
          }),
        })),
      },
    } as never;

    await expect(getSharedDemoActorWithCtx(ctx, { now: 10_000 })).resolves.toEqual({
      kind: "shared_demo",
      athenaUserId: "athena-user",
      authUserId: "auth-user",
      organizationId: "organization",
      storeId: "store",
    });
  });

  it("rejects an expired principal instead of classifying it as normal", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue({ admissionExpiresAt: 9_999 }),
          })),
        })),
      },
    } as never;
    await expect(getSharedDemoActorWithCtx(ctx, { now: 10_000 })).rejects.toThrow(
      "shared demo session has expired",
    );
  });

  it("revokes an active principal immediately when the runtime gate is disabled", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: { query: vi.fn(() => ({ withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue({ admissionExpiresAt: 20_000 }) })) })) },
    } as never;
    await expect(getSharedDemoActorWithCtx(ctx, { environment: {}, now: 10_000 })).rejects.toThrow("unavailable in this environment");
  });

  it("keeps admission expiry isolated between per-admission auth users", async () => {
    const principals = new Map([
      ["old-auth-user", { admissionExpiresAt: 9_999 }],
      [
        "new-auth-user",
        {
          admissionExpiresAt: 20_000,
          athenaUserId: "shared-athena-user",
          organizationId: "shared-organization",
          storeId: "shared-store",
        },
      ],
    ]);
    const contextFor = (authUserId: string) => ({
      auth: { getUserIdentity: vi.fn() },
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn((_name, apply) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return {
              unique: vi.fn().mockResolvedValue(principals.get(authUserId)),
            };
          }),
        })),
      },
    });

    vi.mocked(getAuthUserId)
      .mockResolvedValueOnce("old-auth-user" as never)
      .mockResolvedValueOnce("new-auth-user" as never);

    await expect(
      getSharedDemoActorWithCtx(contextFor("old-auth-user") as never, {
        now: 10_000,
      }),
    ).rejects.toThrow("shared demo session has expired");
    await expect(
      getSharedDemoActorWithCtx(contextFor("new-auth-user") as never, {
        now: 10_000,
      }),
    ).resolves.toMatchObject({
      authUserId: "new-auth-user",
      athenaUserId: "shared-athena-user",
      storeId: "shared-store",
    });
  });

  it("preserves normal actors but denies protected demo capabilities", async () => {
    vi.mocked(getAuthUserId).mockResolvedValueOnce(null);
    const normalCtx = { auth: { getUserIdentity: vi.fn() }, db: {} } as never;
    await expect(
      requireSharedDemoCapabilityIfApplicable(normalCtx, "exports.generate"),
    ).resolves.toBeNull();

    vi.mocked(getAuthUserId).mockResolvedValueOnce("demo-auth" as never);
    const demoCtx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue({
              admissionExpiresAt: Date.now() + 60_000,
              athenaUserId: "athena-user",
              organizationId: "organization",
              storeId: "store",
            }),
          })),
        })),
      },
    } as never;
    await expect(
      requireSharedDemoCapabilityIfApplicable(demoCtx, "exports.generate"),
    ).rejects.toThrow("This action is unavailable in the shared demo.");
  });
});
