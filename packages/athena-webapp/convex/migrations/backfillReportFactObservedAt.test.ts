import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Validator } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { reportFactSchema } from "../schemas/reports/facts";

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

  const runAfter = vi.fn(async (..._args: unknown[]) => "job" as never);
  return {
    ctx: { db: { patch, query }, scheduler: { runAfter } } as any,
    facts,
    patch,
    runAfter,
  };
}

function createStoreVerificationCtx(initialFacts: Fact[]) {
  const storeRunAfter = vi.fn(async (..._args: unknown[]) => "job" as never);
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
    ctx: {
      db: { get: vi.fn(async () => store), patch, query },
      scheduler: { runAfter: storeRunAfter },
    } as any,
    facts,
    store,
    runAfter: storeRunAfter,
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
  it("drives itself to completion when autoContinue is set", async () => {
    const harness = createCtx([
      { _creationTime: 100, _id: "fact-1" },
      { _creationTime: 200, _id: "fact-2" },
      { _creationTime: 300, _id: "fact-3", observedAt: 300 },
    ]);

    const first = await backfillReportFactObservedAtWithCtx(harness.ctx, {
      autoContinue: true,
      dryRun: false,
      limit: 2,
    });

    expect(first.isDone).toBe(false);
    // The chain carries the cursor and the running totals, so the last batch
    // can report the whole job rather than its own slice.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      changedSoFar: 2,
      cursor: first.continueCursor,
      dryRun: false,
      limit: 2,
      processedSoFar: 2,
    });

    const second = await backfillReportFactObservedAtWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second.isDone).toBe(true);
    expect(second.totals).toEqual({
      changedCount: 2,
      missingCount: 2,
      processedCount: 3,
    });
    expect(harness.facts.map((fact) => fact.observedAt)).toEqual([
      100, 200, 300,
    ]);
    // A finished chain must not schedule another link.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
  });

  it("never self-schedules unless autoContinue is requested", async () => {
    const harness = createCtx([
      { _creationTime: 100, _id: "fact-1" },
      { _creationTime: 200, _id: "fact-2" },
    ]);

    const result = await backfillReportFactObservedAtWithCtx(harness.ctx, {
      dryRun: true,
      limit: 1,
    });

    expect(result.isDone).toBe(false);
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

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

describe("report-fact observedAt narrowing gate", () => {
  function observedAtField() {
    return (
      reportFactSchema as unknown as {
        fields: Record<string, Validator<any, any, any> & { isOptional: string }>;
      }
    ).fields.observedAt;
  }

  it("keeps knowledge time widened while the backfill is still the mechanism", () => {
    expect(observedAtField().isOptional).toBe("optional");
  });

  it("continues a store verification to completion under autoContinue", async () => {
    const harness = createStoreVerificationCtx([
      { _creationTime: 100, _id: "fact-1", observedAt: 100 },
      { _creationTime: 200, _id: "fact-2", observedAt: 200 },
    ]);

    const first = await verifyStoreReportFactObservedAtWithCtx(harness.ctx, {
      autoContinue: true,
      limit: 1,
      storeId: "store-1" as Id<"store">,
    });
    expect(first.isDone).toBe(false);
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      cursor: first.continueCursor,
      storeId: "store-1",
    });

    const second = await verifyStoreReportFactObservedAtWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second).toMatchObject({ complete: true, isDone: true });
    // Terminal batch stops the chain.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
  });

  it("GUARD: narrowing must not land while the completion check can still find stragglers", async () => {
    await expect(
      finishVerification(createCtx([{ _creationTime: 1, _id: "legacy" }]).ctx),
    ).resolves.toEqual({ complete: false, missingCount: 1 });
    await expect(
      finishVerification(
        createCtx([{ _creationTime: 1, _id: "stamped", observedAt: 1 }]).ctx,
      ),
    ).resolves.toEqual({ complete: true, missingCount: 0 });

    // The check still tells the two worlds apart, so production may still hold
    // un-backfilled facts. Making `observedAt` required before every
    // deployment reports zero would reject writes to rows the migration has
    // not reached. Retire the completion check in the same change, or this
    // guard fails.
    expect(observedAtField().isOptional).toBe("optional");
  });
});
