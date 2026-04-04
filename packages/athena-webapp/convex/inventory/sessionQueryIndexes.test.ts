import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("POS and expense session indexing", () => {
  it("adds the session indexes needed for bounded cashier, terminal, and expiry lookups", () => {
    const schema = readProjectFile("convex", "schema.ts");

    expect(schema).toContain(
      '.index("by_cashierId_and_status", ["cashierId", "status"])'
    );
    expect(schema).toContain(
      '.index("by_status_and_expiresAt", ["status", "expiresAt"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_terminalId", ["storeId", "terminalId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_cashierId", ["storeId", "cashierId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])'
    );
    expect(schema).toContain(
      '.index("by_storeId_status_cashierId", ["storeId", "status", "cashierId"])'
    );
  });

  it("uses targeted session indexes instead of broad status scans in posSessions", () => {
    const source = readProjectFile("convex", "inventory", "posSessions.ts");

    expect(source).toContain('withIndex("by_cashierId_and_status"');
    expect(source).toContain('withIndex("by_status_and_expiresAt"');
    expect(source).toContain('withIndex("by_storeId_status_terminalId"');
    expect(source).toContain('withIndex("by_storeId_status_cashierId"');
    expect(source).toContain('withIndex("by_storeId_terminalId"');
    expect(source).toContain('withIndex("by_storeId_cashierId"');

    expect(source).not.toContain(
      '.withIndex("by_cashierId", (q) => q.eq("cashierId", args.cashierId))\n      .filter((q) => q.eq(q.field("status"), "active"))'
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

    expect(source).toContain('withIndex("by_cashierId_and_status"');
    expect(source).toContain('withIndex("by_status_and_expiresAt"');
    expect(source).toContain('withIndex("by_storeId_status_terminalId"');
    expect(source).toContain('withIndex("by_storeId_status_cashierId"');
    expect(source).toContain('withIndex("by_storeId_terminalId"');
    expect(source).toContain('withIndex("by_storeId_cashierId"');

    expect(source).not.toContain(
      '.withIndex("by_cashierId", (q) => q.eq("cashierId", args.cashierId))\n      .filter((q) => q.eq(q.field("status"), "active"))'
    );
    expect(source).not.toContain(
      '.withIndex("by_status", (q) => q.eq("status", "active"))\n      .filter((q) => q.lt(q.field("expiresAt"), now))'
    );
  });
});
