/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { convexToJson } from "convex/values";

import schema from "../schema";
import {
  recordReadCosts,
  serializedReadPayloadBytes,
} from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");

describe("read-cost fixture recorder", () => {
  it("measures UTF-8 Convex JSON, including non-JSON-native values", () => {
    const document = {
      label: "é🧾",
      counter: 2n,
      bytes: new Uint8Array([1, 2]).buffer,
    };
    const json = JSON.stringify(convexToJson(document));
    expect(serializedReadPayloadBytes(document)).toBe(
      new TextEncoder().encode(json).byteLength,
    );
    expect(serializedReadPayloadBytes(document)).toBeGreaterThan(json.length);
  });

  it("counts explicit and legacy gets, misses, and repeat hydration without measuring writes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const id = await recorder.ctx.db.insert("athenaUser", {
        email: "é@test",
      });
      const row = await recorder.ctx.db.get("athenaUser", id);
      expect(row).not.toBeNull();
      const bytes = serializedReadPayloadBytes(row!);
      const first = recorder.snapshot();
      expect(first.total).toEqual({
        calls: 1,
        returnedDocuments: 1,
        serializedBytes: bytes,
      });
      // eslint-disable-next-line @convex-dev/explicit-table-ids -- exercise the recorder's backwards-compatible read overload
      expect(await recorder.ctx.db.get(id)).toEqual(row);
      await recorder.ctx.db.patch("athenaUser", id, { email: "changed@test" });
      await recorder.ctx.db.delete("athenaUser", id);
      expect(await recorder.ctx.db.get("athenaUser", id)).toBeNull();
      expect(recorder.snapshot()).toEqual({
        total: { calls: 3, returnedDocuments: 2, serializedBytes: bytes * 2 },
        byTable: {
          athenaUser: {
            calls: 3,
            returnedDocuments: 2,
            serializedBytes: bytes * 2,
          },
        },
      });
      expect(first.total.calls).toBe(1); // snapshots are detached
    });
  });

  it("records take, collect, first, unique and paginate once after query chaining", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const email of ["a@test", "b@test", "c@test"]) {
        await ctx.db.insert("athenaUser", { email, normalizedEmail: email });
      }
      const recorder = recordReadCosts(ctx);
      const db = recorder.ctx.db;
      const taken = await db.query("athenaUser").order("asc").take(2);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- three-row fixture deliberately covers the terminal recorder API
      const all = await db.query("athenaUser").collect();
      const first = await db.query("athenaUser").first();
      const unique = await db
        .query("athenaUser")
        .withIndex("by_normalizedEmail", (q) =>
          q.eq("normalizedEmail", "b@test"),
        )
        .unique();
      const absent = await db
        .query("athenaUser")
        .withIndex("by_normalizedEmail", (q) =>
          q.eq("normalizedEmail", "missing@test"),
        )
        .unique();
      const page = await db
        .query("athenaUser")
        .order("asc")
        .paginate({ cursor: null, numItems: 1 });
      expect(page.isDone).toBe(false);
      expect(absent).toBeNull();
      const returned = [...taken, ...all, first!, unique!, ...page.page];
      expect(returned).toHaveLength(8);
      expect(recorder.snapshot().byTable.athenaUser).toEqual({
        calls: 6,
        returnedDocuments: returned.length,
        serializedBytes: returned.reduce(
          (sum, row) => sum + serializedReadPayloadBytes(row),
          0,
        ),
      });
      // The unreturned pagination probe is intentionally not invented here.
    });
  });

  it("counts only yielded iterator rows, supports early break and empty iteration", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const email of ["a@test", "b@test", "c@test"]) {
        await ctx.db.insert("athenaUser", { email, normalizedEmail: email });
      }
      const recorder = recordReadCosts(ctx);
      const returned = [];
      for await (const row of recorder.ctx.db
        .query("athenaUser")
        .order("desc")) {
        returned.push(row);
        break;
      }
      for await (const row of recorder.ctx.db.query("athenaUser"))
        returned.push(row);
      for await (const row of recorder.ctx.db
        .query("athenaUser")
        .withIndex("by_normalizedEmail", (q) =>
          q.eq("normalizedEmail", "missing@test"),
        )) {
        returned.push(row);
      }
      expect(returned).toHaveLength(4);
      expect(recorder.snapshot().total).toEqual({
        calls: 3,
        returnedDocuments: 4,
        serializedBytes: returned.reduce(
          (sum, row) => sum + serializedReadPayloadBytes(row),
          0,
        ),
      });
    });
  });

  it("keeps table totals separate and delegates terminal errors", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", { email: "a@test" });
      await ctx.db.insert("athenaUser", { email: "b@test" });
      await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Fixture",
        slug: "fixture",
      });
      const recorder = recordReadCosts(ctx);
      await expect(
        recorder.ctx.db.query("athenaUser").unique(),
      ).rejects.toThrow();
      await recorder.ctx.db.query("organization").take(1);
      const result = recorder.snapshot();
      expect(result.byTable.athenaUser).toEqual({
        calls: 1,
        returnedDocuments: 0,
        serializedBytes: 0,
      });
      expect(result.byTable.organization.returnedDocuments).toBe(1);
      expect(result.total.calls).toBe(2);
      expect(result.total.serializedBytes).toBe(
        result.byTable.organization.serializedBytes,
      );
    });
  });
});
