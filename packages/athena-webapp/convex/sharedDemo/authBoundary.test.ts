import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("./actor", () => ({ getSharedDemoActorWithCtx: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { getSharedDemoActorWithCtx } from "./actor";

describe("shared demo explicit Athena identity adapter", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth" as never);
    vi.mocked(getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: "demo-athena",
      kind: "shared_demo",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);
  });

  it("does not resolve a demo admission through the ordinary email path", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: { get: vi.fn().mockResolvedValue({ name: "Athena demo owner" }) },
    } as never;
    await expect(getAuthenticatedAthenaUserWithCtx(ctx)).resolves.toBeNull();
  });

  it("maps only when the caller declares an explicit read capability", async () => {
    const demoUser = { _id: "demo-athena", email: "synthetic@demo.invalid" };
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string) =>
          table === "athenaUser" ? demoUser : null,
        ),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            first: vi.fn(async () => null),
            take: vi.fn(async () => []),
          })),
        })),
      },
    } as never;
    await expect(
      getAuthenticatedAthenaUserWithCtx(ctx, {
        sharedDemoCapability: "reports.read",
      }),
    ).resolves.toEqual(demoUser);

    vi.mocked(getSharedDemoActorWithCtx).mockClear();

    await expect(
      getAuthenticatedAthenaUserWithCtx(ctx, {
        sharedDemoCapability: "pos.sale.complete",
      }),
    ).resolves.toBeNull();
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();
  });
});
