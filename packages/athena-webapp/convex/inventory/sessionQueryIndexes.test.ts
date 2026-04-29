import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

const readSourceSlice = (
  source: string,
  startMarker: string,
  endMarker?: string,
) => {
  const startIndex = source.indexOf(startMarker);
  if (startIndex === -1) {
    throw new Error(`Expected marker not found: ${startMarker}`);
  }

  if (!endMarker) {
    return source.slice(startIndex);
  }

  const endIndex = source.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    throw new Error(`Expected end marker not found: ${endMarker}`);
  }

  return source.slice(startIndex, endIndex);
};

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
    expect(schema).toContain('.index("by_expiresAt", ["expiresAt"])');
    expect(schema).toContain('.index("by_registerSessionId", ["registerSessionId"])');
  });

  it("uses targeted session indexes instead of broad status scans in posSessions", () => {
    const source = readProjectFile("convex", "inventory", "posSessions.ts");

    expect(source).toContain('withIndex("by_staffProfileId_and_status"');
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

  it("uses expiry index once for pos session cleanup and filters statuses in-code", () => {
    const source = readProjectFile("convex", "inventory", "posSessions.ts");
    const helperSource = readSourceSlice(
      source,
      "async function listPosSessionsByStatusBefore(",
      "async function listPosSessionsForStoreStatus(",
    );

    expect(helperSource).toContain('withIndex("by_expiresAt",');
    expect(helperSource).not.toContain(
      'withIndex("by_status_and_expiresAt",'
    );
    expect(helperSource).not.toContain("Promise.all");
    expect(helperSource.match(/\.paginate\(/)?.length).toBe(1);

    const releaseSource = readSourceSlice(
      source,
      "export const releasePosSessionItems = internalMutation({",
      "// Clear old completed/void sessions (cleanup utility)",
    );

    expect(releaseSource).not.toContain("Promise.all");
    expect(releaseSource).toContain("listPosSessionsByStatusBefore(ctx, now)");
  });

  it("uses targeted session indexes instead of broad status scans in expenseSessions", () => {
    const source = readProjectFile(
      "convex",
      "inventory",
      "expenseSessions.ts"
    );
    const repositorySource = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "repositories",
      "expenseSessionCommandRepository.ts",
    );
    const combinedSource = `${source}\n${repositorySource}`;

    expect(source).toContain('withIndex("by_storeId_status_terminalId"');
    expect(combinedSource).toContain(
      'withIndex("by_storeId_status_staffProfileId"',
    );
    expect(source).toContain('withIndex("by_storeId_terminalId"');
    expect(source).toContain('withIndex("by_storeId_staffProfileId"');

    expect(combinedSource).not.toContain(
      '.withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", args.staffProfileId))\n      .filter((q) => q.eq(q.field("status"), "active"))'
    );
    expect(combinedSource).not.toContain(
      '.withIndex("by_status", (q) => q.eq("status", "active"))\n          .filter((q) => q.lt(q.field("expiresAt"), now))'
    );
  });

  it("exposes register session binding on expense session schema and query DTOs", () => {
    const schemaSource = readProjectFile(
      "convex",
      "schemas",
      "pos",
      "expenseSession.ts",
    );
    const expenseSessionSource = readProjectFile(
      "convex",
      "inventory",
      "expenseSessions.ts",
    );

    expect(schemaSource).toContain(
      'registerSessionId: v.optional(v.id("registerSession"))',
    );

    const storeListSource = readSourceSlice(
      expenseSessionSource,
      "export const getStoreExpenseSessions = query({",
      "// Get a specific expense session by ID",
    );
    const byIdSource = readSourceSlice(
      expenseSessionSource,
      "export const getExpenseSessionById = query({",
      "// Create a new expense session",
    );
    const activeSource = readSourceSlice(
      expenseSessionSource,
      "export const getActiveExpenseSession = query({",
      "// Release inventory holds from expired expense sessions",
    );

    expect(storeListSource).toContain(
      'registerSessionId: v.optional(v.id("registerSession"))',
    );
    expect(byIdSource).toContain(
      'registerSessionId: v.optional(v.id("registerSession"))',
    );
    expect(activeSource).toContain(
      'registerSessionId: v.optional(v.id("registerSession"))',
    );
  });

  it("uses expiry index once for expense session cleanup and filters statuses in-code", () => {
    const source = readProjectFile(
      "convex",
      "inventory",
      "expenseSessions.ts",
    );
    const helperSource = readSourceSlice(
      source,
      "async function listExpenseSessionsByStatusBefore(",
      "export const getStoreExpenseSessions = query({",
    );

    expect(helperSource).toContain('withIndex("by_expiresAt",');
    expect(helperSource).not.toContain(
      'withIndex("by_status_and_expiresAt",'
    );
    expect(helperSource).not.toContain("Promise.all");
    expect(helperSource.match(/\.paginate\(/)?.length).toBe(1);

    const releaseSource = readSourceSlice(
      source,
      "export const releaseExpenseSessionItems = internalMutation({",
    );

    expect(releaseSource).not.toContain("Promise.all");
    expect(releaseSource).toContain(
      "const expiredSessions = await listExpenseSessionsByStatusBefore(ctx, now);"
    );
  });
});
