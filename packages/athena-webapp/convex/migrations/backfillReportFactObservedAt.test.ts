import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

import {
  backfillReportFactObservedAtWithCtx,
  verifyStoreReportFactObservedAtWithCtx,
  verifyReportFactObservedAtWithCtx,
} from "./backfillReportFactObservedAt";

type Fact = {
  _creationTime: number;
  _id: string;
  observedAt?: number;
};

function createCtx(initialFacts: Fact[]) {
  const facts = structuredClone(initialFacts);
  const patch = vi.fn(
    async (_table: string, id: string, value: Record<string, unknown>) => {
      const fact = facts.find((candidate) => candidate._id === id);
      if (!fact) throw new Error(`Missing fact ${id}`);
      Object.assign(fact, value);
    },
  );
  const query = vi.fn(() => ({
    paginate: vi.fn(
      async ({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) => {
        const start = cursor ? Number(cursor) : 0;
        const end = Math.min(start + numItems, facts.length);
        return {
          continueCursor: String(end),
          isDone: end >= facts.length,
          page: facts.slice(start, end),
        };
      },
    ),
  }));

  return { ctx: { db: { patch, query } } as any, facts, patch };
}

function createStoreVerificationCtx(initialFacts: Fact[]) {
  const facts = structuredClone(initialFacts);
  const store = { _id: "store-1" } as {
    _id: string;
    weeklyObservedAtVerification?: Record<string, unknown>;
  };
  const patch = vi.fn(
    async (table: string, id: string, value: Record<string, unknown>) => {
      if (table === "store" && id === store._id) Object.assign(store, value);
    },
  );
  const query = vi.fn(() => ({
    withIndex: vi.fn(() => ({
      paginate: vi.fn(
        async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
          const start = cursor ? Number(cursor) : 0;
          const end = Math.min(start + numItems, facts.length);
          return {
            continueCursor: String(end),
            isDone: end >= facts.length,
            page: facts.slice(start, end),
          };
        },
      ),
    })),
  }));
  return {
    ctx: { db: { get: vi.fn(async () => store), patch, query } } as any,
    facts,
    store,
  };
}

async function finishBackfill(
  ctx: ReturnType<typeof createCtx>["ctx"],
  dryRun: boolean,
) {
  let cursor: string | null = null;
  let changedCount = 0;
  let missingCount = 0;
  while (true) {
    const result = await backfillReportFactObservedAtWithCtx(ctx, {
      cursor,
      dryRun,
      limit: 1,
    });
    changedCount += result.changedCount;
    missingCount += result.missingCount;
    if (result.isDone) return { changedCount, missingCount };
    cursor = result.continueCursor;
  }
}

async function finishVerification(ctx: ReturnType<typeof createCtx>["ctx"]) {
  let cursor: string | null = null;
  let missingCount = 0;
  while (true) {
    const result = await verifyReportFactObservedAtWithCtx(ctx, {
      cursor,
      limit: 1,
    });
    missingCount += result.missingCount;
    if (result.isDone) return { complete: missingCount === 0, missingCount };
    cursor = result.continueCursor;
  }
}

describe("report-fact observedAt backfill", () => {
  it("previews, resumes, and applies immutable creation time exactly once", async () => {
    const harness = createCtx([
      { _creationTime: 100, _id: "fact-1" },
      { _creationTime: 200, _id: "fact-2", observedAt: 250 },
      { _creationTime: 300, _id: "fact-3" },
    ]);

    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      complete: false,
      missingCount: 2,
    });
    await expect(finishBackfill(harness.ctx, true)).resolves.toEqual({
      changedCount: 0,
      missingCount: 2,
    });
    expect(harness.patch).not.toHaveBeenCalled();

    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 2,
      missingCount: 2,
    });
    expect(harness.facts.map((fact) => fact.observedAt)).toEqual([
      100, 250, 300,
    ]);
    await expect(finishBackfill(harness.ctx, false)).resolves.toEqual({
      changedCount: 0,
      missingCount: 0,
    });
    await expect(finishVerification(harness.ctx)).resolves.toEqual({
      complete: true,
      missingCount: 0,
    });
  });

  it("keeps the cutoff index as an explicit completion prerequisite", () => {
    const schema = readFileSync(
      join(process.cwd(), "convex", "schema.ts"),
      "utf8",
    );
    expect(schema).toContain('.index("by_storeId_operatingDate_observedAt", [');
    expect(schema).toContain('"observedAt",');
  });

  it("writes durable capability evidence only after a store-wide zero-missing verification", async () => {
    const harness = createStoreVerificationCtx([
      { _creationTime: 100, _id: "legacy-fact" },
    ]);

    await expect(
      verifyStoreReportFactObservedAtWithCtx(harness.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({ complete: false, isDone: true, missingCount: 1 });
    expect(harness.store.weeklyObservedAtVerification).toMatchObject({
      status: "incomplete",
      missingCount: 1,
    });

    harness.facts[0]!.observedAt = 100;
    await expect(
      verifyStoreReportFactObservedAtWithCtx(harness.ctx, {
        limit: 25,
        storeId: "store-1" as Id<"store">,
      }),
    ).resolves.toMatchObject({ complete: true, isDone: true, missingCount: 0 });
    expect(harness.store.weeklyObservedAtVerification).toMatchObject({
      status: "complete",
      missingCount: 0,
    });
  });
});
