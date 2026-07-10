import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { backfillAthenaUserNormalizedEmailBatchWithCtx } from "./backfillAthenaUserNormalizedEmail";

type User = {
  _id: Id<"athenaUser">;
  email: string;
  normalizedEmail?: string;
};

function context(initialUsers: User[]) {
  const users = structuredClone(initialUsers);
  const tables = new Map<string, Array<Record<string, unknown>>>([
    ["athenaUser", users],
    ["reportingIdentityMigrationRun", []],
    ["reportingIdentityMigrationCandidate", []],
    ["reportingIntegrityAttempt", []],
  ]);
  const patches: Array<{
    table: string;
    id: string;
    value: Record<string, unknown>;
  }> = [];
  let nextId = 1;

  const db = {
    get: vi.fn(
      async (table: string, id: string) =>
        (tables.get(table) ?? []).find((row) => row._id === id) ?? null,
    ),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      const row = { _id: id, _creationTime: Date.now(), ...value };
      const rows = tables.get(table) ?? [];
      rows.push(row);
      tables.set(table, rows);
      return id;
    }),
    patch: vi.fn(
      async (table: string, id: string, value: Record<string, unknown>) => {
        patches.push({ table, id, value });
        const row = (tables.get(table) ?? []).find(
          (candidate) => candidate._id === id,
        );
        if (!row) throw new Error(`Missing ${table}:${id}`);
        Object.assign(row, value);
        for (const key of Object.keys(row)) {
          if (row[key] === undefined) delete row[key];
        }
      },
    ),
    query: vi.fn((table: string) => {
      const filters = new Map<string, unknown>();
      const result = {
        paginate: vi.fn(
          async (args: { cursor: string | null; numItems: number }) => {
            const rows = tables.get(table) ?? [];
            const start = args.cursor ? Number(args.cursor) : 0;
            const end = Math.min(start + args.numItems, rows.length);
            return {
              page: rows.slice(start, end),
              continueCursor: String(end),
              isDone: end >= rows.length,
            };
          },
        ),
        withIndex: vi.fn((_index: string, apply: Function) => {
          const q = {
            eq: vi.fn((field: string, value: unknown) => {
              filters.set(field, value);
              return q;
            }),
          };
          apply(q);
          const matching = () =>
            (tables.get(table) ?? []).filter((row) =>
              [...filters.entries()].every(
                ([field, value]) => row[field] === value,
              ),
            );
          return {
            first: vi.fn(async () => matching()[0] ?? null),
            take: vi.fn(async (limit: number) => matching().slice(0, limit)),
          };
        }),
      };
      return result;
    }),
  };

  return { ctx: { db }, patches, tables, users };
}

async function finishRun(
  ctx: ReturnType<typeof context>["ctx"],
  input: {
    automationIdentity: string;
    dryRun: boolean;
    limit: number;
    previewRunId?: Id<"reportingIdentityMigrationRun">;
  },
) {
  let cursor: string | null = null;
  let runId: Id<"reportingIdentityMigrationRun"> | undefined;
  const candidates = [];
  while (true) {
    const result = await backfillAthenaUserNormalizedEmailBatchWithCtx(
      ctx as never,
      { ...input, cursor, runId },
    );
    runId = result.runId;
    candidates.push(...result.candidates);
    if (result.isDone || result.continueCursor === null) {
      return { ...result, candidates, runId };
    }
    cursor = result.continueCursor;
  }
}

describe("Athena user normalized-email backfill", () => {
  it("applies only the cursor-bounded candidates proven by a completed preview", async () => {
    const harness = context([
      { _id: "user-1" as Id<"athenaUser">, email: " Admin@Example.COM " },
      { _id: "user-2" as Id<"athenaUser">, email: "owner@example.com" },
    ]);

    const preview = await finishRun(harness.ctx, {
      automationIdentity: "deploy:reports-u1",
      dryRun: true,
      limit: 1,
    });
    expect(preview.coverageComplete).toBe(true);
    expect(
      harness.patches.filter((patch) => patch.table === "athenaUser"),
    ).toEqual([]);

    const apply = await finishRun(harness.ctx, {
      automationIdentity: "deploy:reports-u1",
      dryRun: false,
      limit: 1,
      previewRunId: preview.runId,
    });

    expect(apply.candidates).toEqual(preview.candidates);
    expect(apply.coverageComplete).toBe(true);
    expect(harness.users.map((user) => user.normalizedEmail)).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
  });

  it("detects normalized duplicates split across cursor pages", async () => {
    const harness = context([
      { _id: "user-1" as Id<"athenaUser">, email: "Admin@example.com" },
      { _id: "user-2" as Id<"athenaUser">, email: "admin@EXAMPLE.com" },
    ]);

    const first = await backfillAthenaUserNormalizedEmailBatchWithCtx(
      harness.ctx as never,
      {
        automationIdentity: "deploy:reports-u1",
        cursor: null,
        dryRun: true,
        limit: 1,
      },
    );
    expect(first.candidates).toEqual([{ action: "update", userId: "user-1" }]);

    const second = await backfillAthenaUserNormalizedEmailBatchWithCtx(
      harness.ctx as never,
      {
        automationIdentity: "deploy:reports-u1",
        cursor: first.continueCursor,
        dryRun: true,
        limit: 1,
        runId: first.runId,
      },
    );

    expect(second.conflictingUserIds).toEqual(["user-1", "user-2"]);
    expect(second.coverageComplete).toBe(false);
    const claims = harness.tables.get("reportingIdentityMigrationCandidate")!;
    expect(claims.map((claim) => claim.action)).toEqual([
      "conflict",
      "conflict",
    ]);
    expect(JSON.stringify(claims)).not.toContain("example.com");
    const evidence = harness.tables.get("reportingIntegrityAttempt")!;
    expect(evidence).toHaveLength(2);
    expect(JSON.stringify(evidence)).not.toContain("example.com");
  });

  it("refuses apply without a completed conflict-free preview", async () => {
    const harness = context([
      { _id: "user-1" as Id<"athenaUser">, email: "Admin@example.com" },
      { _id: "user-2" as Id<"athenaUser">, email: "admin@EXAMPLE.com" },
    ]);
    const preview = await finishRun(harness.ctx, {
      automationIdentity: "deploy:reports-u1",
      dryRun: true,
      limit: 2,
    });

    await expect(
      backfillAthenaUserNormalizedEmailBatchWithCtx(harness.ctx as never, {
        automationIdentity: "deploy:reports-u1",
        dryRun: false,
        limit: 2,
        previewRunId: preview.runId,
      }),
    ).rejects.toThrow("completed conflict-free identity preview");
    expect(
      harness.patches.filter((patch) => patch.table === "athenaUser"),
    ).toEqual([]);
  });
});
