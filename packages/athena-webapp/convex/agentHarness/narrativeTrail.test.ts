/// <reference types="vite/client" />
/**
 * The narrative-trail leaf: one insert-once row per committed turn binding
 * holding that turn's finished drafts, a total-size fit that never drops an
 * entry, and an expiry delete the standard-class sweep drives. The helper has
 * no authority of its own — `turns.ts` decides whether a trail may exist and
 * who may read it; this module only writes, loads, and deletes.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES,
  AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS,
  deleteExpiredTurnNarrativeTrailWithCtx,
  fitNarrativeTrail,
  loadTurnNarrativeTrailByBindingWithCtx,
  writeTurnNarrativeTrailWithCtx,
} from "./narrativeTrail";
import { TEST_NOW, buildRunInput, seedTenant } from "./testSupport";
import { recordTurnIntentWithCtx } from "./turnBindings";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

const bytesOf = (text: string) => new TextEncoder().encode(text).byteLength;

async function seedBinding(ctx: MutationCtx, slug: string) {
  const tenant = await seedTenant(ctx, slug);
  const { runIdempotencyKey: _k, promptPayloadHash: _h, ...base } = buildRunInput(tenant);
  const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: `turn-${slug}`, promptPayload: { prompt: slug } });
  if (intent.outcome !== "created") throw new Error(intent.outcome);
  return { tenant, bindingId: intent.bindingId, runId: intent.runId };
}

function trailInput(
  seeded: { tenant: { storeId: Id<"store">; organizationId: Id<"organization"> }; bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun"> },
  overrides: Partial<Parameters<typeof writeTurnNarrativeTrailWithCtx>[1]> = {},
) {
  return {
    runId: seeded.runId,
    turnBindingId: seeded.bindingId,
    storeId: seeded.tenant.storeId,
    organizationId: seeded.tenant.organizationId,
    entries: [
      { draftOrdinal: 0, text: "Checking which shifts are open.", truncated: false },
      { draftOrdinal: 1, text: "One shift is open, writing it up.", truncated: false },
    ],
    egressClass: "operational",
    committedAt: TEST_NOW,
    now: TEST_NOW,
    ...overrides,
  };
}

describe("narrative trail leaf", () => {
  it("carries its own 365-day retention literal and its own total-size cap", () => {
    expect(AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES).toBe(96 * 1024);
  });

  it("leaves a trail under the cap untouched and reports its byte length", () => {
    const entries = [
      { draftOrdinal: 0, text: "Checking the registers.", truncated: false },
      { draftOrdinal: 1, text: "Now the automation log.", truncated: false },
    ];
    const fitted = fitNarrativeTrail(entries);
    expect(fitted.entries).toEqual(entries);
    expect(fitted.byteLength).toBe(bytesOf(entries[0].text) + bytesOf(entries[1].text));
  });

  it("cuts the longest entry at a whole codepoint, never drops an entry, and flags only what it cut", () => {
    const entries = [
      { draftOrdinal: 0, text: "short", truncated: false },
      // Multi-byte throughout: a raw byte cut would split a codepoint.
      { draftOrdinal: 1, text: "é".repeat(200), truncated: false },
      { draftOrdinal: 2, text: "tail", truncated: false },
    ];
    const fitted = fitNarrativeTrail(entries, { maxBytes: 100 });

    expect(fitted.entries.map((entry) => entry.draftOrdinal)).toEqual([0, 1, 2]);
    expect(fitted.byteLength).toBeLessThanOrEqual(100);
    expect(fitted.byteLength).toBe(fitted.entries.reduce((sum, entry) => sum + bytesOf(entry.text), 0));
    // Only the entry that lost text is flagged; the small ones survive whole.
    expect(fitted.entries[0]).toEqual({ draftOrdinal: 0, text: "short", truncated: false });
    expect(fitted.entries[2]).toEqual({ draftOrdinal: 2, text: "tail", truncated: false });
    expect(fitted.entries[1].truncated).toBe(true);
    // A whole-codepoint cut: every character is still the two-byte "é".
    expect(fitted.entries[1].text).toBe("é".repeat(fitted.entries[1].text.length));
    expect(bytesOf(fitted.entries[1].text)).toBe(fitted.entries[1].text.length * 2);
    expect(fitted.entries[1].text.length).toBeGreaterThan(0);
    // The input is not mutated.
    expect(entries[1].text).toHaveLength(200);
  });

  it("spreads the cut across the largest drafts and keeps every ordinal even under a punishing cap", () => {
    const entries = [
      { draftOrdinal: 0, text: "a".repeat(500), truncated: false },
      { draftOrdinal: 1, text: "b".repeat(500), truncated: false },
      { draftOrdinal: 2, text: "c".repeat(500), truncated: false },
    ];
    const fitted = fitNarrativeTrail(entries, { maxBytes: 600 });
    expect(fitted.entries.map((entry) => entry.draftOrdinal)).toEqual([0, 1, 2]);
    expect(fitted.byteLength).toBeLessThanOrEqual(600);
    // The shortest surviving entry keeps text: the cut lands on the largest first.
    expect(Math.min(...fitted.entries.map((entry) => entry.text.length))).toBeGreaterThan(0);

    // Even at zero the entries survive, marked for what happened to them.
    const starved = fitNarrativeTrail(entries, { maxBytes: 0 });
    expect(starved.entries.map((entry) => entry.draftOrdinal)).toEqual([0, 1, 2]);
    expect(starved.entries.every((entry) => entry.text === "" && entry.truncated)).toBe(true);
    expect(starved.byteLength).toBe(0);
  });

  it("keeps a truncation the caller already made even when nothing else is cut", () => {
    const fitted = fitNarrativeTrail([{ draftOrdinal: 0, text: "cut earlier", truncated: true }]);
    expect(fitted.entries).toEqual([{ draftOrdinal: 0, text: "cut earlier", truncated: true }]);
  });

  it("inserts one row per binding and is idempotent on a re-finalize", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "trail-insert"));

    const first = await t.run((ctx) => writeTurnNarrativeTrailWithCtx(ctx, trailInput(seeded)));
    if (first.outcome !== "inserted") throw new Error(JSON.stringify(first));

    const stored = await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, seeded.bindingId));
    expect(stored).toMatchObject({
      runId: seeded.runId,
      turnBindingId: seeded.bindingId,
      storeId: seeded.tenant.storeId,
      organizationId: seeded.tenant.organizationId,
      egressClass: "operational",
      retentionClass: "standard",
      committedAt: TEST_NOW,
      createdAt: TEST_NOW,
      expiresAt: TEST_NOW + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS,
    });
    expect(stored!.entries).toEqual([
      { draftOrdinal: 0, text: "Checking which shifts are open.", truncated: false },
      { draftOrdinal: 1, text: "One shift is open, writing it up.", truncated: false },
    ]);
    expect(stored!.byteLength).toBe(bytesOf("Checking which shifts are open.") + bytesOf("One shift is open, writing it up."));

    // Insert-once: a second finalize of the same turn never rewrites the record.
    const again = await t.run((ctx) =>
      writeTurnNarrativeTrailWithCtx(ctx, trailInput(seeded, { entries: [{ draftOrdinal: 0, text: "REWRITTEN", truncated: false }], now: TEST_NOW + 1_000 })),
    );
    expect(again).toEqual({ outcome: "already_present", id: first.id });
    const unchanged = await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, seeded.bindingId));
    expect(unchanged!.entries).toHaveLength(2);
    expect(JSON.stringify(unchanged)).not.toContain("REWRITTEN");
    expect(await t.run((ctx) => ctx.db.query("agentTurnNarrativeTrail").withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", seeded.bindingId)).take(3))).toHaveLength(1);
  });

  it("refuses to write an empty trail", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "trail-empty"));
    expect(await t.run((ctx) => writeTurnNarrativeTrailWithCtx(ctx, trailInput(seeded, { entries: [] })))).toEqual({ outcome: "empty" });
    expect(await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, seeded.bindingId))).toBeNull();
  });

  it("fits an over-cap trail on the way in", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "trail-fit"));
    await t.run((ctx) =>
      writeTurnNarrativeTrailWithCtx(
        ctx,
        trailInput(seeded, {
          entries: [
            { draftOrdinal: 0, text: "x".repeat(AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES), truncated: false },
            { draftOrdinal: 1, text: "y".repeat(AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES), truncated: false },
          ],
        }),
      ),
    );
    const stored = await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, seeded.bindingId));
    expect(stored!.entries.map((entry) => entry.draftOrdinal)).toEqual([0, 1]);
    expect(stored!.byteLength).toBeLessThanOrEqual(AGENT_TURN_NARRATIVE_TRAIL_MAX_BYTES);
    expect(stored!.entries.some((entry) => entry.truncated)).toBe(true);
  });

  it("deletes by expiry, in bounded passes", async () => {
    const t = convexTest(schema, modules);
    const one = await t.run((ctx) => seedBinding(ctx, "trail-delete-one"));
    const two = await t.run((ctx) => seedBinding(ctx, "trail-delete-two"));
    await t.run((ctx) => writeTurnNarrativeTrailWithCtx(ctx, trailInput(one)));
    await t.run((ctx) => writeTurnNarrativeTrailWithCtx(ctx, trailInput(two, { now: TEST_NOW + 10_000 })));

    // Not yet expired: the sweep leaves both alone.
    expect(await t.run((ctx) => deleteExpiredTurnNarrativeTrailWithCtx(ctx, { now: TEST_NOW + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS - 1, limit: 10 }))).toEqual({ deleted: 0, hasMore: false });
    // The older row expires first; a bound of one reports more to do.
    expect(await t.run((ctx) => deleteExpiredTurnNarrativeTrailWithCtx(ctx, { now: TEST_NOW + 10_000 + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS, limit: 1 }))).toEqual({ deleted: 1, hasMore: true });
    expect(await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, one.bindingId))).toBeNull();
    expect(await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, two.bindingId))).not.toBeNull();
    expect(await t.run((ctx) => deleteExpiredTurnNarrativeTrailWithCtx(ctx, { now: TEST_NOW + 10_000 + AGENT_TURN_NARRATIVE_TRAIL_RETENTION_MS, limit: 10 }))).toEqual({ deleted: 1, hasMore: false });
    expect(await t.run((ctx) => loadTurnNarrativeTrailByBindingWithCtx(ctx, two.bindingId))).toBeNull();
  });
});
