import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("../sharedDemo/actor", () => ({ getSharedDemoActorWithCtx: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";
import { getSharedDemoActorWithCtx } from "../sharedDemo/actor";
import {
  findAthenaUserByEmailIndexedWithCtx,
  findAthenaUserByEmailWithCtx,
  getAuthenticatedAthenaUserWithCtx,
  normalizeAthenaUserEmail,
  requireAuthenticatedAthenaUserWithCtx,
} from "./athenaUserAuth";

type User = {
  _id: Id<"athenaUser">;
  email: string;
  normalizedEmail?: string;
};

function context(users: User[]) {
  const collect = vi.fn(async () => users);
  return {
    collect,
    ctx: {
      db: {
        query: vi.fn(() => ({
          collect,
          withIndex: vi.fn((_index: string, apply: Function) => {
            let value: string | undefined;
            const q = {
              eq: vi.fn((_field: string, nextValue: string | undefined) => {
                value = nextValue;
                return q;
              }),
            };
            apply(q);
            const matches = users.filter((user) => user.normalizedEmail === value);
            return {
              first: vi.fn(async () => matches[0] ?? null),
              take: vi.fn(async (limit: number) => matches.slice(0, limit)),
            };
          }),
        })),
      },
    },
  };
}

describe("Athena user normalized identity", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getSharedDemoActorWithCtx).mockReset();
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeAthenaUserEmail("  Admin@Example.COM ")).toBe(
      "admin@example.com",
    );
  });

  it("keeps pre-backfill identities usable while coverage is partial", async () => {
    const { ctx } = context([
      {
        _id: "legacy" as Id<"athenaUser">,
        email: "Admin@Example.com",
      },
      {
        _id: "other" as Id<"athenaUser">,
        email: "other@example.com",
        normalizedEmail: "other@example.com",
      },
    ]);

    await expect(
      findAthenaUserByEmailWithCtx(ctx as never, "admin@example.com"),
    ).resolves.toMatchObject({ _id: "legacy" });
  });

  it("fails closed when indexed and legacy identities normalize to the same email", async () => {
    const { ctx } = context([
      {
        _id: "indexed" as Id<"athenaUser">,
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
      },
      {
        _id: "legacy" as Id<"athenaUser">,
        email: "ADMIN@example.com",
      },
    ]);

    await expect(
      findAthenaUserByEmailWithCtx(ctx as never, "admin@example.com"),
    ).rejects.toThrow("Multiple Athena users match this email");
  });

  it("uses only indexed lookup once every identity has normalized coverage", async () => {
    const { collect, ctx } = context([
      {
        _id: "indexed" as Id<"athenaUser">,
        email: "Admin@example.com",
        normalizedEmail: "admin@example.com",
      },
    ]);

    await expect(
      findAthenaUserByEmailWithCtx(ctx as never, "ADMIN@example.com"),
    ).resolves.toMatchObject({ _id: "indexed" });
    expect(collect).not.toHaveBeenCalled();
  });

  it("offers an indexed-only lookup for reactive hot paths", async () => {
    const { collect, ctx } = context([
      {
        _id: "legacy" as Id<"athenaUser">,
        email: "Admin@example.com",
      },
      {
        _id: "indexed" as Id<"athenaUser">,
        email: "Admin@example.com",
        normalizedEmail: "admin@example.com",
      },
    ]);

    await expect(
      findAthenaUserByEmailIndexedWithCtx(ctx as never, "ADMIN@example.com"),
    ).resolves.toMatchObject({ _id: "indexed" });
    expect(collect).not.toHaveBeenCalled();
  });
});

describe("Athena user auth boundary", () => {
  it("keeps ordinary authenticated Athena user resolution unchanged", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("auth-user" as never);
    const authUser = { email: " Admin@Example.COM " };
    const { ctx } = context([
      {
        _id: "athena-user" as Id<"athenaUser">,
        email: "admin@example.com",
        normalizedEmail: "admin@example.com",
      },
    ]);
    const get = vi.fn(async (table: string) =>
      table === "users" ? authUser : null,
    );

    const result = await requireAuthenticatedAthenaUserWithCtx({
      ...(ctx as object),
      auth: { getUserIdentity: vi.fn() },
      db: {
        ...(ctx.db as object),
        get,
      },
    } as never);

    expect(result).toMatchObject({ _id: "athena-user" });
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();
  });

  it("does not map a shared-demo actor into Athena user semantics without an explicit legacy capability option", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth" as never);
    vi.mocked(getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: "demo-athena",
      kind: "shared_demo",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string) =>
          table === "users" ? { email: undefined } : null,
        ),
        query: vi.fn(),
      },
    };

    await expect(
      getAuthenticatedAthenaUserWithCtx(ctx as never),
    ).resolves.toBeNull();
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();
  });

  it("preserves the shared-demo Athena user bridge for explicit read allowlists", async () => {
    const demoUser = {
      _id: "demo-athena" as Id<"athenaUser">,
      email: "synthetic@demo.invalid",
      normalizedEmail: "synthetic@demo.invalid",
    };
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth" as never);
    vi.mocked(getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: demoUser._id,
      kind: "shared_demo",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string, id: string) =>
          table === "athenaUser" && id === demoUser._id ? demoUser : null,
        ),
        query: vi.fn(),
      },
    };

    await expect(
      getAuthenticatedAthenaUserWithCtx(ctx as never, {
        sharedDemoCapability: "reports.read",
      }),
    ).resolves.toEqual(demoUser);
    expect(getAuthUserId).not.toHaveBeenCalled();
  });

  it("does not admit shared-demo write capabilities through the generic Athena user helper", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth" as never);
    vi.mocked(getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: "demo-athena",
      kind: "shared_demo",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: {
        get: vi.fn(async (table: string) =>
          table === "users" ? { email: undefined } : null,
        ),
        query: vi.fn(),
      },
    };

    await expect(
      getAuthenticatedAthenaUserWithCtx(ctx as never, {
        sharedDemoCapability: "pos.sale.complete",
      }),
    ).resolves.toBeNull();
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();
  });
});
