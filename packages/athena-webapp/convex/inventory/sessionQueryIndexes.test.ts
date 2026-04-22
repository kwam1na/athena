import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("POS and expense session indexing", () => {
  it("adds the session indexes needed for bounded staff, terminal, and expiry lookups", () => {
    const schema = readProjectFile("convex", "schema.ts");

    expect(schema).toContain(
      '.index("by_staffProfileId_and_status", ["staffProfileId", "status"])'
    );
    expect(schema).toContain(
      '.index("by_status_and_expiresAt", ["status", "expiresAt"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_terminalId", ["storeId", "terminalId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_staffProfileId", ["storeId", "staffProfileId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_status_staffProfileId", ['
    );
  });

  it("uses targeted session indexes instead of broad status scans in posSessions", () => {
    const source = readProjectFile("convex", "inventory", "posSessions.ts");

    expect(source).toContain('withIndex("by_staffProfileId_and_status"');
    expect(source).toContain('withIndex("by_status_and_expiresAt"');
    expect(source).toContain('withIndex("by_storeId_status_terminalId"');
    expect(source).toContain('withIndex("by_storeId_status_staffProfileId"');
    expect(source).toContain('withIndex("by_storeId_terminalId"');
    expect(source).toContain('withIndex("by_storeId_staffProfileId"');

    expect(source).not.toContain(
      '.withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", args.staffProfileId))\n      .filter((q) => q.eq(q.field("status"), "active"))'
    );
    expect(source).not.toContain(
      '.withIndex("by_status", (q) => q.eq("status", "active"))\n          .filter((q) => q.lt(q.field("expiresAt"), now))'
    );
  });

  it("uses targeted session indexes instead of broad status scans in expenseSessions", () => {
    const source = readProjectFile(
      "convex",
      "inventory",
      "expenseSessions.ts"
    );

    expect(source).toContain('withIndex("by_staffProfileId_and_status"');
    expect(source).toContain('withIndex("by_status_and_expiresAt"');
    expect(source).toContain('withIndex("by_storeId_status_terminalId"');
    expect(source).toContain('withIndex("by_storeId_status_staffProfileId"');
    expect(source).toContain('withIndex("by_storeId_terminalId"');
    expect(source).toContain('withIndex("by_storeId_staffProfileId"');

    expect(source).not.toContain(
      '.withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", args.staffProfileId))\n      .filter((q) => q.eq(q.field("status"), "active"))'
    );
    expect(source).not.toContain(
      '.withIndex("by_status", (q) => q.eq("status", "active"))\n      .filter((q) => q.lt(q.field("expiresAt"), now))'
    );
  });
});
