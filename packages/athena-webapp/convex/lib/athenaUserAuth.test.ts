import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  findAthenaUserByEmailWithCtx,
  normalizeAthenaUserEmail,
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
});
