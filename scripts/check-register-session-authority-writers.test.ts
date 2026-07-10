import { describe, expect, it } from "vitest";

import { collectRegisterSessionAuthorityWriterFindings } from "./check-register-session-authority-writers";

describe("register session authority writer guard", () => {
  it.each([
    ['ctx.db.insert("registerSession", input)', "registerSession"],
    ['ctx.db.patch("registerSession", id, patch)', "registerSession"],
    ['ctx.db.delete("registerSession", id)', "registerSession"],
    ['ctx.db.insert("posLocalSyncMapping", input)', "posLocalSyncMapping"],
    ['ctx.db.patch("posLocalSyncMapping", id, patch)', "posLocalSyncMapping"],
    ['ctx.db.delete("posLocalSyncMapping", id)', "posLocalSyncMapping"],
  ])("flags raw %s writes", (source, table) => {
    expect(
      collectRegisterSessionAuthorityWriterFindings(
        "convex/example.ts",
        source,
      ),
    ).toEqual([expect.objectContaining({ table })]);
  });

  it("allows reads and centralized writer modules", () => {
    expect(
      collectRegisterSessionAuthorityWriterFindings(
        "convex/example.ts",
        'ctx.db.get("registerSession", id)',
      ),
    ).toEqual([]);
    expect(
      collectRegisterSessionAuthorityWriterFindings(
        "convex/operations/registerSessionAuthorityRevision.ts",
        'ctx.db.patch("registerSession", id, patch)',
      ),
    ).toEqual([]);
    expect(
      collectRegisterSessionAuthorityWriterFindings(
        "convex/pos/application/sync/registerMappingAuthorityRevision.ts",
        'ctx.db.insert("posLocalSyncMapping", input)',
      ),
    ).toEqual([]);
  });

  it("flags implicit-id writes that can hide the registerSession table", () => {
    expect(
      collectRegisterSessionAuthorityWriterFindings(
        "convex/example.ts",
        'ctx.db.patch(registerSession._id, { status: "closed" })',
      ),
    ).toEqual([
      expect.objectContaining({ method: "patch", table: "implicit-id" }),
    ]);
  });
});
