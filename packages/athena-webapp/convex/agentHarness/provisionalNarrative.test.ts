/// <reference types="vite/client" />
/**
 * The provisional-narrative leaf: one delete-only row per turn binding, a
 * server-enforced text cap cut at a codepoint boundary, and an expiry delete
 * the repair sweep drives. The helper has no authority of its own — every
 * caller decides whether a row may exist; this module only writes, overwrites,
 * and deletes.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { AGENT_TOOL_NARRATIVE_MAX_BYTES } from "./tools";
import {
  AGENT_PROVISIONAL_NARRATIVE_TTL_MS,
  deleteExpiredProvisionalNarrativesWithCtx,
  deleteProvisionalNarrativeByBindingWithCtx,
  fitProvisionalNarrative,
  loadProvisionalNarrativeByBindingWithCtx,
  upsertProvisionalNarrativeWithCtx,
} from "./provisionalNarrative";
import { TEST_NOW, buildRunInput, seedTenant } from "./testSupport";
import { recordTurnIntentWithCtx } from "./turnBindings";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);

async function seedBinding(ctx: MutationCtx, slug: string) {
  const tenant = await seedTenant(ctx, slug);
  const { runIdempotencyKey: _k, promptPayloadHash: _h, ...base } = buildRunInput(tenant);
  const intent = await recordTurnIntentWithCtx(ctx, { ...base, turnIdempotencyKey: `turn-${slug}`, promptPayload: { prompt: slug } });
  if (intent.outcome !== "created") throw new Error(intent.outcome);
  return { tenant, bindingId: intent.bindingId, runId: intent.runId };
}

function rowInput(seeded: { tenant: { storeId: Id<"store">; organizationId: Id<"organization"> }; bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun"> }, overrides: Partial<Parameters<typeof upsertProvisionalNarrativeWithCtx>[1]> = {}) {
  return {
    runId: seeded.runId,
    turnBindingId: seeded.bindingId,
    storeId: seeded.tenant.storeId,
    organizationId: seeded.tenant.organizationId,
    text: "Checking which shifts are open.",
    draftOrdinal: 0,
    truncated: false,
    egressClass: "operational",
    updatedAt: TEST_NOW,
    expiresAt: TEST_NOW + AGENT_PROVISIONAL_NARRATIVE_TTL_MS,
    ...overrides,
  };
}

describe("provisional narrative leaf", () => {
  it("carries its own five-minute TTL literal", () => {
    expect(AGENT_PROVISIONAL_NARRATIVE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("cuts over-cap text at the last whole codepoint at or below the cap, never inside a multibyte sequence", () => {
    const encoder = new TextEncoder();
    const small = fitProvisionalNarrative("short", AGENT_TOOL_NARRATIVE_MAX_BYTES);
    expect(small).toEqual({ text: "short", truncated: false });

    // Two-byte codepoints straddling the cap: the cut lands on a boundary.
    const twoByte = "é".repeat(AGENT_TOOL_NARRATIVE_MAX_BYTES);
    const fittedTwo = fitProvisionalNarrative(twoByte, AGENT_TOOL_NARRATIVE_MAX_BYTES);
    expect(fittedTwo.truncated).toBe(true);
    expect(encoder.encode(fittedTwo.text).byteLength).toBe(AGENT_TOOL_NARRATIVE_MAX_BYTES);
    expect(fittedTwo.text).toBe("é".repeat(AGENT_TOOL_NARRATIVE_MAX_BYTES / 2));

    // Four-byte astral codepoints (surrogate pairs in JS): a cap that is not a
    // multiple of four must step back to the previous whole codepoint.
    const astral = "😀".repeat(10);
    const fittedAstral = fitProvisionalNarrative(astral, 10);
    expect(fittedAstral).toEqual({ text: "😀😀", truncated: true });
    expect(encoder.encode(fittedAstral.text).byteLength).toBe(8);
    // Never a lone surrogate half.
    expect(fittedAstral.text.isWellFormed()).toBe(true);
    expect(fitProvisionalNarrative(astral, 11).text.isWellFormed()).toBe(true);

    // Exactly on the cap is not truncation.
    expect(fitProvisionalNarrative("a".repeat(16), 16)).toEqual({ text: "a".repeat(16), truncated: false });
    expect(fitProvisionalNarrative("a".repeat(17), 16)).toEqual({ text: "a".repeat(16), truncated: true });
  });

  it("keeps exactly one row per binding: insert, overwrite, delete", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "leaf"));
    await t.run(async (ctx) => {
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId)).toBeNull();
      expect(await upsertProvisionalNarrativeWithCtx(ctx, rowInput(seeded))).toMatchObject({ outcome: "inserted" });
      const first = await loadProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId);
      expect(first).toMatchObject({ text: "Checking which shifts are open.", draftOrdinal: 0, truncated: false, retentionClass: "short_lived", egressClass: "operational" });

      // A later draft overwrites the same row; the egress class stamped on
      // insert stays (the caller refuses before reaching here when it changes).
      expect(
        await upsertProvisionalNarrativeWithCtx(ctx, rowInput(seeded, { text: "One shift is open.", draftOrdinal: 1, truncated: true, egressClass: "sensitive", updatedAt: TEST_NOW + 5, expiresAt: TEST_NOW + 6 })),
      ).toMatchObject({ outcome: "updated" });
      const rows = await ctx.db.query("agentProvisionalNarrative").withIndex("by_turnBindingId", (q) => q.eq("turnBindingId", seeded.bindingId)).take(5);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ text: "One shift is open.", draftOrdinal: 1, truncated: true, egressClass: "operational", updatedAt: TEST_NOW + 5, expiresAt: TEST_NOW + 6 });

      expect(await deleteProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId)).toBe(1);
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId)).toBeNull();
      // Idempotent: nothing left, nothing counted.
      expect(await deleteProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId)).toBe(0);
    });
  });

  it("expiry delete is bounded, counts what it removed, and leaves live rows alone", async () => {
    const t = convexTest(schema, modules);
    const bindings = await t.run(async (ctx) => {
      const out = [];
      for (const slug of ["e1", "e2", "e3", "live"]) out.push(await seedBinding(ctx, slug));
      return out;
    });
    await t.run(async (ctx) => {
      for (const [index, seeded] of bindings.entries()) {
        const expiresAt = seeded === bindings[3] ? TEST_NOW + AGENT_PROVISIONAL_NARRATIVE_TTL_MS : TEST_NOW + index;
        await upsertProvisionalNarrativeWithCtx(ctx, rowInput(seeded, { expiresAt }));
      }
      const now = TEST_NOW + 10;
      expect(await deleteExpiredProvisionalNarrativesWithCtx(ctx, { now, limit: 2 })).toEqual({ deleted: 2, hasMore: true });
      expect(await deleteExpiredProvisionalNarrativesWithCtx(ctx, { now, limit: 2 })).toEqual({ deleted: 1, hasMore: false });
      expect(await deleteExpiredProvisionalNarrativesWithCtx(ctx, { now, limit: 2 })).toEqual({ deleted: 0, hasMore: false });
      expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, bindings[3].bindingId)).not.toBeNull();
      for (const seeded of bindings.slice(0, 3)) expect(await loadProvisionalNarrativeByBindingWithCtx(ctx, seeded.bindingId)).toBeNull();
      // A row exactly at `expiresAt === now` is expired (the exposure bound is inclusive).
      await upsertProvisionalNarrativeWithCtx(ctx, rowInput(bindings[0], { expiresAt: now }));
      expect(await deleteExpiredProvisionalNarrativesWithCtx(ctx, { now, limit: 5 })).toEqual({ deleted: 1, hasMore: false });
    });
  });
});
