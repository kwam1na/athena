/// <reference types="vite/client" />
/**
 * Citations (plan U6 scenarios 4, 5; ticket V26-1264): opaque refs bound to
 * run/attempt/call/result hash are minted only from released data; completeRun
 * accepts them only from the explicit successful-attempt set; forged, stale,
 * cross-run, unreleased, and unauthorized references are rejected with typed
 * reasons; evidence lookup reauthorizes the viewer and exposes no raw ids.
 */
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import { scanForRawIdentifiers } from "../../shared/agentHarness/results";
import { looksLikeRawDocumentId, parseOpaqueRef } from "../../shared/agentHarness/values";
import {
  AUDIT_TRAIL_MANIFEST,
  SHIFTS_MANIFEST,
  STORE_DAY_MANIFEST,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_NOW_BASE,
  TEST_PORT_BEHAVIOR,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import { mintAttemptRef, mintCitationRef, parseAttemptRef, parseCitationRef, resolveCitationRefsWithCtx } from "./citations";
import { TEST_EXECUTOR_SEAMS, beginExecutingAttempt, bridgeCall, seedDelegatedRun, type TestBridgeRequest } from "./executor.testSeams";
import { listCapabilityCallsForRun } from "./lifecycle";

vi.mock("../sharedDemo/restore", () => ({
  requireReadySharedDemoWriteWithCtx: vi.fn(),
}));

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];
modules["./agentHarness/testSeams.ts"] = modules["./agentHarness/executor.testSeams.ts"];

type Harness = TestConvex<typeof schema>;

const shifts: TestBridgeRequest = { capabilityId: SHIFTS_MANIFEST.capabilityId, namespace: "ops.shifts", verb: "list", args: { status: "open" } };
const storeDay: TestBridgeRequest = { capabilityId: STORE_DAY_MANIFEST.capabilityId, namespace: "ops.storeDay", verb: "get", args: { operatingDate: "2026-08-21" } };
const audit: TestBridgeRequest = { capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId, namespace: "ops.auditTrail", verb: "list", args: {} };

const DIAGNOSTICS = { elapsedMs: 5, hostCalls: 2, maxInFlight: 1, bridgeArgsBytes: 20, bridgeOutputBytes: 500, resultBytes: 30, sourceBytes: 60 };

async function seedResultAttempt(t: Harness, slug: string, options: { key?: string; withBinding?: boolean; requests?: TestBridgeRequest[]; run?: Awaited<ReturnType<typeof seedDelegatedRun>> } = {}) {
  const run = options.run ?? (await t.run((ctx) => seedDelegatedRun(ctx, slug, { withBinding: options.withBinding })));
  const attempt = await t.run((ctx) => beginExecutingAttempt(ctx, run, { key: options.key }));
  for (const request of options.requests ?? [shifts, storeDay]) {
    const call = await bridgeCall(t, run, attempt.attemptId, request, { key: `${options.key ?? "a1"}-${request.namespace}` });
    if (call.settled?.outcome !== "released") throw new Error(JSON.stringify(call));
  }
  const finished = await t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, { attemptId: attempt.attemptId, end: { status: "completed", output: { ok: true }, diagnostics: DIAGNOSTICS }, now: TEST_NOW_BASE + 50 }),
  );
  if (finished.outcome !== "result") throw new Error(JSON.stringify(finished));
  return { run, attempt, finished };
}

function complete(t: Harness, runId: Awaited<ReturnType<typeof seedDelegatedRun>>["runId"], input: { citedAttemptRefs: string[]; citations: { ref: string; claim?: string }[]; key?: string }) {
  return t.run((ctx) =>
    TEST_EXECUTOR_SEAMS.completeRunWithCtx(ctx, {
      runId,
      idempotencyKey: input.key ?? "complete",
      citedAttemptRefs: input.citedAttemptRefs,
      citations: input.citations,
      artifact: { payload: { answer: "..." } },
      now: TEST_NOW_BASE + 100,
    }),
  );
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
  TEST_PORT_BEHAVIOR.shifts = "normal";
});

describe("opaque citation and attempt references", () => {
  it("mints opaque, run/attempt/call/hash-bound refs that round-trip and never look like raw identifiers", () => {
    const binding = { runId: "run" as never, attemptId: "attempt" as never, attemptSequence: 2, callId: "call" as never, callSequence: 7, resultHash: "fnv1a64:abc" };
    const ref = mintCitationRef(binding);
    expect(parseOpaqueRef(ref)).toMatchObject({ kind: "citation" });
    expect(looksLikeRawDocumentId(ref)).toBe(false);
    expect(parseCitationRef(ref)).toMatchObject({ attemptSequence: 2, callSequence: 7 });
    expect(mintCitationRef({ ...binding, resultHash: "fnv1a64:abd" })).not.toBe(ref);
    expect(mintCitationRef({ ...binding, runId: "other" as never })).not.toBe(ref);
    expect(parseCitationRef("citation:v1.2.7.nothex")).toBeNull();
    expect(parseCitationRef("source:v1.2.7.abcdef")).toBeNull();
    const attemptRef = mintAttemptRef({ runId: "run" as never, attemptId: "attempt" as never, sequence: 2, resultHash: "sha256:abc" });
    expect(attemptRef).toMatch(/^attempt_v1\.2\.[0-9a-f]{32}$/);
    expect(parseAttemptRef(attemptRef)).toMatchObject({ sequence: 2 });
    expect(parseAttemptRef("attempt_v1.2.zz")).toBeNull();
    expect(scanForRawIdentifiers({ ref, attemptRef })).toEqual([]);
  });
});

describe("citations reference only sanitized data the bound successful attempt returned (scenario 4)", () => {
  it("offers one candidate per released call, tied to the call's result hash, and completeRun binds exactly those", async () => {
    const t = convexTest(schema, modules);
    const { run, finished } = await seedResultAttempt(t, "bound");
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, run.runId));
    expect(finished.citations).toHaveLength(2);
    for (const candidate of finished.citations) {
      const call = calls.find((row) => row.resultHash === candidate.resultHash)!;
      expect(call.status).toBe("succeeded");
      expect(candidate.sourceRefs.every((ref) => ref.ref.startsWith("source:"))).toBe(true);
      expect(scanForRawIdentifiers(candidate)).toEqual([]);
    }
    expect(finished.result.derivedFromCallRefs).toEqual(finished.citations.map((candidate) => candidate.citation));
    const completed = await complete(t, run.runId, { citedAttemptRefs: [finished.attemptRef], citations: finished.citations.map((candidate) => ({ ref: candidate.citation, claim: "claim" })) });
    expect(completed).toMatchObject({ outcome: "completed" });
    if (completed.outcome !== "completed") return;
    const bindings = await t.run(async (ctx) => Promise.all(completed.citationBindingIds.map((id) => ctx.db.get("agentCitationBinding", id))));
    expect(bindings.map((binding) => [binding!.citationKey, binding!.resultHash])).toEqual(finished.citations.map((candidate) => [candidate.citation, candidate.resultHash]));
    expect(bindings.every((binding) => binding!.claimDigest?.startsWith("sha256:"))).toBe(true);
  });

  it("rejects a reference to a withheld call: only released data can be cited", async () => {
    const t = convexTest(schema, modules);
    const run = await t.run((ctx) => seedDelegatedRun(ctx, "withheld"));
    const attempt = await t.run((ctx) => beginExecutingAttempt(ctx, run));
    TEST_PORT_BEHAVIOR.shifts = "unavailable";
    const withheld = await bridgeCall(t, run, attempt.attemptId, shifts, { key: "u" });
    expect(withheld.settled).toMatchObject({ outcome: "withheld" });
    TEST_PORT_BEHAVIOR.shifts = "normal";
    const released = await bridgeCall(t, run, attempt.attemptId, storeDay, { key: "d" });
    expect(released.settled).toMatchObject({ outcome: "released" });
    const finished = await t.run((ctx) => TEST_EXECUTOR_SEAMS.finishAttemptWithCtx(ctx, { attemptId: attempt.attemptId, end: { status: "completed", output: { ok: true }, diagnostics: DIAGNOSTICS }, now: TEST_NOW_BASE + 50 }));
    if (finished.outcome !== "result") throw new Error(JSON.stringify(finished));
    expect(finished.citations.map((candidate) => candidate.namespace)).toEqual(["ops.storeDay"]);
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, run.runId));
    const unavailable = calls.find((call) => call.status === "unavailable")!;
    const forgedForWithheld = mintCitationRef({ runId: run.runId, attemptId: attempt.attemptId, attemptSequence: attempt.sequence, callId: unavailable._id, callSequence: unavailable.sequence, resultHash: "fnv1a64:0" });
    const rejected = await complete(t, run.runId, { citedAttemptRefs: [finished.attemptRef], citations: [{ ref: forgedForWithheld }] });
    expect(rejected).toMatchObject({ outcome: "rejected", reason: "citation_not_released" });
  });
});

describe("forged, stale-attempt, cross-run, and unauthorized citations are rejected (scenario 5)", () => {
  it("rejects malformed and forged references, a stale attempt outside the cited set, and a reference minted for another run", async () => {
    const t = convexTest(schema, modules);
    const first = await seedResultAttempt(t, "forge", { key: "a1" });
    const second = await seedResultAttempt(t, "forge", { key: "a2", run: first.run });
    const citation = first.finished.citations[0].citation;
    const secondCitation = second.finished.citations[0].citation;

    expect(await complete(t, first.run.runId, { citedAttemptRefs: [first.finished.attemptRef], citations: [{ ref: "citation:v1.1.1.deadbeef" }] })).toMatchObject({ outcome: "rejected", reason: "citation_malformed" });
    const forged = citation.replace(/[0-9a-f]{32}$/, (digest) => (digest[0] === "0" ? "1" : "0") + digest.slice(1));
    expect(await complete(t, first.run.runId, { citedAttemptRefs: [first.finished.attemptRef], citations: [{ ref: forged }] })).toMatchObject({ outcome: "rejected", reason: "citation_binding_mismatch" });
    expect(await complete(t, first.run.runId, { citedAttemptRefs: [first.finished.attemptRef], citations: [{ ref: "citation:v1.1.99.0123456789abcdef0123456789abcdef" }] })).toMatchObject({ outcome: "rejected", reason: "citation_unknown_call" });
    // Attempt 2 succeeded too, but only attempt 1 is in the cited set: its citations are stale.
    expect(await complete(t, first.run.runId, { citedAttemptRefs: [first.finished.attemptRef], citations: [{ ref: secondCitation }] })).toMatchObject({ outcome: "rejected", reason: "citation_stale_attempt" });
    expect(await complete(t, first.run.runId, { citedAttemptRefs: ["attempt_v1.9.0123456789abcdef0123456789abcdef"], citations: [] })).toMatchObject({ outcome: "rejected", reason: "attempt_unknown_attempt" });
    expect(await complete(t, first.run.runId, { citedAttemptRefs: [second.finished.attemptRef.replace(/[0-9a-f]{32}$/, "0123456789abcdef0123456789abcdef")], citations: [] })).toMatchObject({ outcome: "rejected", reason: "attempt_binding_mismatch" });

    const foreign = await seedResultAttempt(t, "foreign");
    expect(await complete(t, foreign.run.runId, { citedAttemptRefs: [foreign.finished.attemptRef], citations: [{ ref: citation }] })).toMatchObject({ outcome: "rejected", reason: expect.stringMatching(/^citation_(binding_mismatch|unknown_call|stale_attempt)$/) });
    expect(await complete(t, foreign.run.runId, { citedAttemptRefs: [first.finished.attemptRef], citations: [] })).toMatchObject({ outcome: "rejected", reason: expect.stringMatching(/^attempt_(binding_mismatch|unknown_attempt)$/) });

    // Pure resolver: the cited-attempt map is the explicit allowed set.
    const resolution = await t.run(async (ctx) => {
      const attempt = (await ctx.db.get("agentProgramAttempt", first.attempt.attemptId))!;
      return resolveCitationRefsWithCtx(ctx, { runId: first.run.runId, refs: [citation], citedAttempts: new Map([[attempt._id, attempt]]) });
    });
    expect(resolution).toMatchObject({ kind: "resolved", citations: [{ ref: citation }] });
    const runs = await t.run((ctx) => ctx.db.get("intelligenceRun", first.run.runId));
    expect(runs?.status).toBe("running");
  });

  it("refuses citations whose capability was disabled or whose operator lost authority, and nothing completes", async () => {
    const t = convexTest(schema, modules);
    const { run, finished } = await seedResultAttempt(t, "unauthorized");
    TEST_ENABLEMENT.narrow({ capabilities: { [SHIFTS_MANIFEST.capabilityId]: "disabled" } });
    const shiftsCitation = finished.citations.find((candidate) => candidate.namespace === "ops.shifts")!.citation;
    expect(await complete(t, run.runId, { citedAttemptRefs: [finished.attemptRef], citations: [{ ref: shiftsCitation }] })).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "capability_disabled" } });
    TEST_ENABLEMENT.reset();
    await t.run((ctx) => ctx.db.delete("organizationMember", run.operator.membershipId!));
    expect(await complete(t, run.runId, { citedAttemptRefs: [finished.attemptRef], citations: [{ ref: shiftsCitation }] })).toMatchObject({ outcome: "refused", stage: "operator" });
    const row = await t.run((ctx) => ctx.db.get("intelligenceRun", run.runId));
    expect(row?.status).toBe("running");
    expect(row?.artifactId).toBeUndefined();
  });
});

describe("evidence lookup reauthorizes the viewer (scenario 5)", () => {
  it("serves lineage without raw identifiers to an operator who still holds authority and the bound read intents, and refuses everyone else", async () => {
    const t = convexTest(schema, modules);
    const { run, finished } = await seedResultAttempt(t, "viewer", { requests: [shifts, audit] });
    const completed = await complete(t, run.runId, { citedAttemptRefs: [finished.attemptRef], citations: finished.citations.map((candidate) => ({ ref: candidate.citation, claim: "claim" })) });
    if (completed.outcome !== "completed") throw new Error(JSON.stringify(completed));
    const auditCitation = finished.citations.find((candidate) => candidate.namespace === "ops.auditTrail")!.citation;
    const shiftsCitation = finished.citations.find((candidate) => candidate.namespace === "ops.shifts")!.citation;
    const lookup = (citationRef: string, viewer: { kind: "normal_user"; athenaUserId: typeof run.operator.userId }) =>
      t.run((ctx) => TEST_EXECUTOR_SEAMS.readCitationEvidenceWithCtx(ctx, { runId: run.runId, citationRef, viewer, purpose: "operator_review", now: TEST_NOW_BASE + 200 }));

    const owner = { kind: "normal_user" as const, athenaUserId: run.operator.userId };
    const view = await lookup(auditCitation, owner);
    expect(view).toMatchObject({ kind: "evidence", state: "reconstructible", citation: { citationRef: auditCitation, namespace: "ops.auditTrail", immutableRevisionRef: expect.stringMatching(/@rev-7$/) } });
    expect(scanForRawIdentifiers(view)).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/"[a-z0-9]{32}"/);

    const cashier = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", { email: "cashier@test" });
      await ctx.db.insert("organizationMember", { organizationId: run.operator.organizationId, userId, role: "pos_only", operationalRoles: ["cashier"] });
      return userId;
    });
    expect(await lookup(auditCitation, { kind: "normal_user", athenaUserId: cashier })).toEqual({ kind: "unauthorized", reason: "read_intent_not_held" });
    expect(await lookup(shiftsCitation, { kind: "normal_user", athenaUserId: cashier })).toMatchObject({ kind: "evidence", state: "reconstructible" });

    const stranger = await t.run((ctx) => seedDelegatedOperator(ctx, "stranger", { role: "full_admin" }));
    expect(await lookup(auditCitation, { kind: "normal_user", athenaUserId: stranger.userId })).toMatchObject({ kind: "unauthorized" });
    expect(await lookup("citation:v1.1.1.0123456789abcdef0123456789abcdef", owner)).toEqual({ kind: "not_found" });

    await t.run((ctx) => ctx.db.delete("organizationMember", run.operator.membershipId!));
    expect(await lookup(auditCitation, owner)).toMatchObject({ kind: "unauthorized", reason: "membership_revoked" });
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- bounded test inspection
    const audits = await t.run((ctx) => ctx.db.query("agentEvidenceAccessAudit").withIndex("by_runId_accessedAt", (q) => q.eq("runId", run.runId)).collect());
    expect(audits.map((row) => row.evidenceState)).toEqual(["reconstructible", "reconstructible"]);
  });
});
