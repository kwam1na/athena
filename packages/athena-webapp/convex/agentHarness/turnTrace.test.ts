/// <reference types="vite/client" />
/**
 * The turn-trace leaf: append-only rows for one driven turn, a server-enforced
 * per-row payload cap cut at a codepoint boundary, and an expiry delete the
 * standard-class sweep drives.
 *
 * The helper has no authority of its own — the recording mutation decides
 * whether a row may exist and stamps the scope; this module only writes,
 * deletes, and measures.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { TEST_NOW, buildRunInput, seedTenant } from "./testSupport";
import {
  AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES,
  AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN,
  AGENT_TURN_TRACE_RETENTION_MS,
  appendTurnTraceEventsWithCtx,
  deleteExpiredTurnTraceWithCtx,
  fitTracePayload,
  isAgentTurnTraceEnabled,
  listTurnTraceByBindingWithCtx,
} from "./turnTrace";
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

function rowInput(
  seeded: { tenant: { storeId: Id<"store">; organizationId: Id<"organization"> }; bindingId: Id<"agentTurnBinding">; runId: Id<"intelligenceRun"> },
  overrides: Partial<Parameters<typeof appendTurnTraceEventsWithCtx>[1][number]> = {},
) {
  return {
    runId: seeded.runId,
    turnBindingId: seeded.bindingId,
    storeId: seeded.tenant.storeId,
    organizationId: seeded.tenant.organizationId,
    source: "adapter" as const,
    sequence: 0,
    at: TEST_NOW,
    kind: "narrative_delta",
    payload: { text: "Checking which shifts" },
    truncated: false,
    expiresAt: TEST_NOW + AGENT_TURN_TRACE_RETENTION_MS,
    createdAt: TEST_NOW,
    ...overrides,
  };
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;

afterEach(() => {
  delete process.env.AGENT_TURN_TRACE;
});

describe("turn trace leaf", () => {
  it("carries its own standard-class retention literal and bounds", () => {
    expect(AGENT_TURN_TRACE_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES).toBe(32 * 1024);
    expect(AGENT_TURN_TRACE_MAX_EVENTS_PER_TURN).toBe(4_000);
  });

  it("is on unless the switch says otherwise", () => {
    delete process.env.AGENT_TURN_TRACE;
    expect(isAgentTurnTraceEnabled()).toBe(true);
    for (const value of ["off", "0", "false", "OFF", " False "]) {
      process.env.AGENT_TURN_TRACE = value;
      expect(isAgentTurnTraceEnabled(), value).toBe(false);
    }
    for (const value of ["on", "1", "true", "yes", ""]) {
      process.env.AGENT_TURN_TRACE = value;
      expect(isAgentTurnTraceEnabled(), JSON.stringify(value)).toBe(true);
    }
  });

  it("leaves an under-cap payload untouched", () => {
    const payload = { toolId: "athena.executeProgram", args: { source: "return 1;" } };
    expect(fitTracePayload(payload)).toEqual({ payload, truncated: false });
  });

  it("cuts an over-cap string at the last whole codepoint at or below the cap, never inside a multibyte sequence", () => {
    const fitted = fitTracePayload("é".repeat(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES));
    expect(fitted.truncated).toBe(true);
    expect(typeof fitted.payload).toBe("string");
    expect(byteLength(fitted.payload)).toBeLessThanOrEqual(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES);
    // A cut inside a two-byte sequence would produce a replacement character.
    expect(fitted.payload as string).not.toMatch(/�/);
    expect(new Set(fitted.payload as string)).toEqual(new Set("é"));
  });

  it("truncates an object's largest string leaves first and keeps the rest of the shape", () => {
    const payload = {
      toolId: "athena.executeProgram",
      callId: "c1",
      args: { source: "x".repeat(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES * 2), note: "small" },
    };
    const fitted = fitTracePayload(payload);
    expect(fitted.truncated).toBe(true);
    expect(byteLength(fitted.payload)).toBeLessThanOrEqual(AGENT_TURN_TRACE_EVENT_PAYLOAD_MAX_BYTES);
    const kept = fitted.payload as typeof payload;
    expect(kept.toolId).toBe("athena.executeProgram");
    expect(kept.callId).toBe("c1");
    expect(kept.args.note).toBe("small");
    expect(kept.args.source.length).toBeGreaterThan(0);
    expect(kept.args.source).toMatch(/^x+$/);
  });

  it("falls back to a byte-length marker when no string leaf can carry the excess", () => {
    const payload = { rows: Array.from({ length: 20_000 }, (_, index) => index) };
    const fitted = fitTracePayload(payload);
    expect(fitted).toEqual({ payload: { omitted: true, byteLength: byteLength(payload) }, truncated: true });
  });

  it("drops undefined-valued keys so every payload is a storable Convex value", () => {
    expect(fitTracePayload({ code: undefined, kind: "turn_completed" })).toEqual({ payload: { kind: "turn_completed" }, truncated: false });
    expect(fitTracePayload(undefined)).toEqual({ payload: null, truncated: false });
  });

  it("appends rows in sequence order and deletes every row of one binding", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "trace-append"));
    const other = await t.run((ctx) => seedBinding(ctx, "trace-other"));

    const appended = await t.run((ctx) =>
      appendTurnTraceEventsWithCtx(ctx, [
        rowInput(seeded, { sequence: 2, kind: "tool_call_requested", payload: { toolId: "athena.executeProgram" } }),
        rowInput(seeded, { sequence: 0, kind: "turn_started", payload: {} }),
        rowInput(seeded, { sequence: 1, kind: "narrative_delta", payload: { text: "Checking" } }),
      ]),
    );
    expect(appended).toBe(3);
    await t.run((ctx) => appendTurnTraceEventsWithCtx(ctx, [rowInput(other, { kind: "turn_started", payload: {} })]));

    const listed = await t.run((ctx) => listTurnTraceByBindingWithCtx(ctx, seeded.bindingId, 10));
    expect(listed.map((row) => [row.sequence, row.kind])).toEqual([
      [0, "turn_started"],
      [1, "narrative_delta"],
      [2, "tool_call_requested"],
    ]);

    // Another turn's trace is its own.
    expect(await t.run((ctx) => listTurnTraceByBindingWithCtx(ctx, other.bindingId, 10))).toHaveLength(1);
  });

  it("expiry delete is bounded, counts what it removed, and leaves live rows alone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedBinding(ctx, "trace-expiry"));
    await t.run((ctx) =>
      appendTurnTraceEventsWithCtx(ctx, [
        rowInput(seeded, { sequence: 0, expiresAt: TEST_NOW - 1 }),
        rowInput(seeded, { sequence: 1, expiresAt: TEST_NOW - 1 }),
        rowInput(seeded, { sequence: 2, expiresAt: TEST_NOW + 60_000 }),
      ]),
    );

    expect(await t.run((ctx) => deleteExpiredTurnTraceWithCtx(ctx, { now: TEST_NOW, limit: 1 }))).toEqual({ deleted: 1, hasMore: true });
    expect(await t.run((ctx) => deleteExpiredTurnTraceWithCtx(ctx, { now: TEST_NOW, limit: 10 }))).toEqual({ deleted: 1, hasMore: false });
    const left = await t.run((ctx) => listTurnTraceByBindingWithCtx(ctx, seeded.bindingId, 10));
    expect(left.map((row) => row.sequence)).toEqual([2]);
  });
});
