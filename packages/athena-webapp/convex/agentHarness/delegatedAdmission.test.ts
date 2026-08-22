/// <reference types="vite/client" />

/**
 * Delegated admission end to end: admit → domain-owned read port → release,
 * under two operators, with revocation, disablement, cancellation, widening
 * attempts, unregistered targets, and the revocation race between dispatch
 * and release (ticket V26-1262).
 */
import { convexTest } from "convex-test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import type { OperationActorKind } from "../operationAdmission/types";
import { createAgentReadPortRegistry, mintAgentCursor, type AgentReadPortInvocation } from "./readPorts";
import { createDelegatedAdmission, type DelegatedCallAdmission } from "./delegatedAdmission";
import {
  AUDIT_TRAIL_MANIFEST,
  SHIFTS_MANIFEST,
  STORE_DAY_MANIFEST,
  TEST_ADMISSION,
  TEST_AUTHORITY_PORTS,
  TEST_CLOCK,
  TEST_ENABLEMENT,
  TEST_GRANT_CONFIG,
  TEST_NOW_BASE,
  TEST_PORT_BEHAVIOR,
  TEST_PORT_BINDINGS,
  TEST_PROFILE_ID,
  TEST_REGISTRY,
  seedDelegatedOperator,
} from "./delegatedAdmission.testPorts";
import {
  beginProgramAttemptWithCtx,
  cancelAgentRunWithCtx,
  listCapabilityCallsForRun,
  markAgentRunRunningWithCtx,
  transitionProgramAttemptWithCtx,
} from "./lifecycle";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./agentHarness/"),
    loader,
  ]),
);
modules["./agentHarness/testPorts.ts"] = modules["./agentHarness/delegatedAdmission.testPorts.ts"];

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));

type Operator = Awaited<ReturnType<typeof seedDelegatedOperator>>;
type Harness = ReturnType<typeof convexTest>;

async function seedExecutingRun(
  ctx: MutationCtx,
  operator: Operator,
  options: { key?: string; operatorKind?: "normal_user" | "shared_demo"; authUserId?: Id<"users"> } = {},
) {
  const materialized = await TEST_ADMISSION.materializeRunGrantWithCtx(ctx, {
    operator: { kind: options.operatorKind ?? "normal_user", athenaUserId: operator.userId, authUserId: options.authUserId },
    profileId: TEST_PROFILE_ID,
    organizationId: operator.organizationId,
    storeId: operator.storeId,
    promptPayloadHash: "sha256:prompt",
    runIdempotencyKey: options.key ?? `turn-${operator.storeId}`,
    now: TEST_NOW_BASE,
  });
  if (materialized.kind !== "materialized") throw new Error(JSON.stringify(materialized));
  await markAgentRunRunningWithCtx(ctx, { runId: materialized.runId, now: TEST_NOW_BASE });
  const begun = await beginProgramAttemptWithCtx(ctx, {
    runId: materialized.runId,
    attemptIdempotencyKey: "attempt-1",
    programSource: "return athena.ops.shifts.list({ status: 'open' });",
    now: TEST_NOW_BASE,
  });
  if (begun.outcome === "denied") throw new Error(begun.denial.code);
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "validating", now: TEST_NOW_BASE });
  await transitionProgramAttemptWithCtx(ctx, { attemptId: begun.attemptId, to: "executing", now: TEST_NOW_BASE, leaseMs: 30_000 });
  return { runId: materialized.runId, grantId: materialized.grantId, attemptId: begun.attemptId, runtimeGrant: materialized.runtimeGrant };
}

type SeededRun = Awaited<ReturnType<typeof seedExecutingRun>>;

type BridgeRequest = {
  capabilityId: string;
  namespace: string;
  verb: "get" | "list";
  args: never;
  projections?: readonly string[];
  cursor?: string;
};

const shiftsRequest = (args: Record<string, unknown> = { status: "open" }, extra: Record<string, unknown> = {}): BridgeRequest => ({
  capabilityId: SHIFTS_MANIFEST.capabilityId,
  namespace: "ops.shifts",
  verb: "list" as const,
  args: args as never,
  ...extra,
});

/**
 * What the executor's action does with an admitted invocation: resolve the
 * handler from the closed in-process map by key and run the query. No
 * reference crosses the mutation boundary.
 */
function runPort(t: Harness, admission: typeof TEST_ADMISSION, invocation: AgentReadPortInvocation) {
  return admission.dispatchReadPort({ runQuery: (reference, args) => t.query(reference, args) as never }, invocation);
}

/** The whole bridge sequence the program executor runs: admit (mutation) → port (query) → release (mutation). */
async function invoke(
  t: Harness,
  run: SeededRun,
  request: BridgeRequest,
  options: { key?: string; now?: number; admission?: typeof TEST_ADMISSION; between?: () => Promise<void> } = {},
) {
  const admission = options.admission ?? TEST_ADMISSION;
  const now = options.now ?? TEST_NOW_BASE + 10;
  const admit = await t.run((ctx) =>
    admission.admitCapabilityCallWithCtx(ctx, {
      runId: run.runId,
      attemptId: run.attemptId,
      callIdempotencyKey: options.key ?? `call-${request.namespace}-${JSON.stringify(request.args)}`,
      request: request as never,
      now,
    }),
  );
  if (admit.outcome !== "admitted") return { admit, response: undefined, release: undefined };
  const response = await runPort(t, admission, admit.invocation);
  await options.between?.();
  const release = await t.run((ctx) =>
    admission.releaseCapabilityResultWithCtx(ctx, { callId: admit.callId, response, now: now + 5 }),
  );
  return { admit, response, release };
}

function releasedData(result: Awaited<ReturnType<typeof invoke>>) {
  if (!result.release || result.release.outcome !== "released") {
    throw new Error(`expected released, got ${JSON.stringify(result.release ?? result.admit)}`);
  }
  return result.release.envelope.data as Record<string, unknown>[] | Record<string, unknown>;
}

async function seedTwoOperators(t: Harness) {
  return t.run(async (ctx) => {
    const alpha = await seedDelegatedOperator(ctx, "alpha", { role: "full_admin" });
    const beta = await seedDelegatedOperator(ctx, "beta", { role: "pos_only", operationalRoles: ["cashier"] });
    return { alpha, beta, runA: await seedExecutingRun(ctx, alpha), runB: await seedExecutingRun(ctx, beta) };
  });
}

beforeEach(() => {
  TEST_ENABLEMENT.reset();
  TEST_CLOCK.now = TEST_NOW_BASE;
  TEST_PORT_BEHAVIOR.shifts = "normal";
});

describe("scenario 1 — same program, different operators", () => {
  it("returns only each operator's records, with fields the other operator never sees", async () => {
    const t = convexTest(schema, modules);
    const { runA, runB } = await seedTwoOperators(t);
    const program = [shiftsRequest({ status: "open" }), shiftsRequest({})];

    const [aOpen, aAll] = [await invoke(t, runA, program[0]), await invoke(t, runA, program[1])];
    const [bOpen, bAll] = [await invoke(t, runB, program[0]), await invoke(t, runB, program[1])];

    const aRows = releasedData(aOpen) as Record<string, unknown>[];
    const bRows = releasedData(bOpen) as Record<string, unknown>[];
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(aRows[0].label).toBe("alpha store evening");
    expect(bRows[0].label).toBe("beta store evening");
    expect(Object.keys(aRows[0]).sort()).toEqual(["label", "managerNotes", "revenue", "shiftRef", "status"]);
    expect(Object.keys(bRows[0]).sort()).toEqual(["label", "shiftRef", "status"]);
    expect("revenue" in bRows[0]).toBe(false);
    expect(JSON.stringify(bRows)).not.toContain("null");
    expect(JSON.stringify(bRows)).not.toContain("alpha");
    expect((releasedData(aAll) as unknown[]).length).toBe(2);
    expect((releasedData(bAll) as unknown[]).length).toBe(2);
    expect(runB.runtimeGrant.grantedProjectionsByCapability[SHIFTS_MANIFEST.capabilityId]).toEqual([]);
    expect(runA.runtimeGrant.grantedProjectionsByCapability[SHIFTS_MANIFEST.capabilityId]).toEqual(["financials", "managerNotes"]);
  });

  it("makes a capability the operator does not hold structurally absent and unauthorized on call, recorded once", async () => {
    const t = convexTest(schema, modules);
    const { runA, runB } = await seedTwoOperators(t);
    const audit = { capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId, namespace: "ops.auditTrail", verb: "list" as const, args: {} as never };

    const forA = await invoke(t, runA, audit);
    expect(forA.release).toMatchObject({ outcome: "released" });
    expect(runA.runtimeGrant.capabilityIds).toContain(AUDIT_TRAIL_MANIFEST.capabilityId);

    expect(runB.runtimeGrant.capabilityIds).not.toContain(AUDIT_TRAIL_MANIFEST.capabilityId);
    const forB = await invoke(t, runB, audit);
    expect(forB.admit).toMatchObject({
      outcome: "refused",
      result: { kind: "unauthorized", code: "unauthorized_capability" },
    });
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, runB.runId));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      status: "denied",
      capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId,
      delegation: { admission: "refused", refusal: { stage: "capability" } },
    });
    expect(calls[0].charged.calls).toBe(1);
    expect(calls[0].charged.rows).toBe(0);
  });
});

describe("scenario 2 — revocation denies the next call immediately", () => {
  it("after membership revocation, store re-scoping, capability disable, and run cancellation", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA } = await seedTwoOperators(t);
    const call = (key: string) => invoke(t, runA, shiftsRequest(), { key });

    expect((await call("ok-1")).release).toMatchObject({ outcome: "released" });

    TEST_ENABLEMENT.narrow({ capabilities: { [SHIFTS_MANIFEST.capabilityId]: "disabled" } });
    expect((await call("disabled")).admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "capability_disabled" } });
    TEST_ENABLEMENT.reset();

    await t.run(async (ctx) => {
      const other = await seedDelegatedOperator(ctx, "other", { role: "full_admin" });
      await ctx.db.patch("store", alpha.storeId, { organizationId: other.organizationId });
    });
    expect((await call("rescoped")).admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    await t.run((ctx) => ctx.db.patch("store", alpha.storeId, { organizationId: alpha.organizationId }));

    await t.run((ctx) => ctx.db.delete("organizationMember", alpha.membershipId!));
    expect((await call("revoked")).admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    await t.run((ctx) => ctx.db.insert("organizationMember", { organizationId: alpha.organizationId, userId: alpha.userId, role: "full_admin" }));
    expect((await call("ok-2")).release).toMatchObject({ outcome: "released" });

    await t.run((ctx) => cancelAgentRunWithCtx(ctx, { runId: runA.runId, idempotencyKey: "cancel", reason: "operator", now: TEST_NOW_BASE + 50 }));
    expect((await call("after-cancel")).admit).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "run_not_running" } });

    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(calls.map((c) => [c.callIdempotencyKey, c.status])).toEqual([
      ["ok-1", "succeeded"],
      ["disabled", "denied"],
      ["rescoped", "denied"],
      ["revoked", "denied"],
      ["ok-2", "succeeded"],
    ]);
    expect(calls.find((c) => c.callIdempotencyKey === "revoked")?.delegation?.refusal).toMatchObject({ stage: "operator", reason: "membership_revoked" });
  });
});

describe("scenario 3 — nothing the program controls can widen a grant", () => {
  it("rejects an ungranted projection request, argument-smuggled scope, foreign cursors, and unsupported verbs", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA, runB } = await seedTwoOperators(t);

    const projection = await invoke(t, runB, shiftsRequest({ status: "open" }, { projections: ["financials"] }));
    expect(projection.admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_projection" } });

    const smuggled = await invoke(t, runB, shiftsRequest({ storeId: String(alpha.storeId) }));
    expect(smuggled.admit).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "invalid_arguments" } });

    const firstPage = await invoke(t, runA, shiftsRequest({}), { key: "page-1" });
    const cursor = (releasedData(firstPage) && firstPage.release?.outcome === "released" ? firstPage.release.envelope.pagination?.cursor : undefined) as string;
    expect(cursor).toMatch(/^cursor:/);
    const foreignCursor = await invoke(t, runB, shiftsRequest({}, { cursor }), { key: "foreign-cursor" });
    expect(foreignCursor.admit).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "invalid_arguments" } });
    const secondPage = await invoke(t, runA, shiftsRequest({}, { cursor }), { key: "page-2" });
    expect(secondPage.release).toMatchObject({ outcome: "released", envelope: { pagination: { hasMore: false, pageIndex: 1 } } });
    // The kernel never mints a cursor past `maxPagesPerRun` (the last page carries none),
    // so only a forged run-bound cursor can ask for a third page — and admission refuses it.
    expect(secondPage.release?.outcome === "released" ? secondPage.release.envelope.pagination?.cursor : "x").toBeUndefined();
    const forgedThird = mintAgentCursor({ runId: runA.runId, portKey: "ops.shifts", rawCursor: "page-3", pageIndex: 2 });
    const thirdPage = await invoke(t, runA, shiftsRequest({}, { cursor: forgedThird }), { key: "page-3" });
    expect(thirdPage.admit).toMatchObject({ outcome: "refused", reason: "page_budget_exhausted", result: { kind: "denied", code: "invalid_arguments" } });

    const verb = await invoke(t, runA, { ...shiftsRequest(), verb: "get" as never }, { key: "verb" });
    expect(verb.admit).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "unsupported_verb" } });

    const mismatched = await invoke(t, runA, { ...shiftsRequest(), namespace: "ops.auditTrail" }, { key: "mismatched" });
    expect(mismatched.admit).toMatchObject({ outcome: "refused", result: { kind: "denied", code: "invalid_arguments" } });

    const unknownCapability = await invoke(t, runA, { ...shiftsRequest(), capabilityId: "cap_does_not_exist" }, { key: "unknown" });
    expect(unknownCapability.admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_capability" } });
  });

  it("keeps concurrent calls and a mid-run promotion on the pinned grant", async () => {
    const t = convexTest(schema, modules);
    const { beta, runB } = await seedTwoOperators(t);
    await t.run((ctx) => ctx.db.patch("organizationMember", beta.membershipId!, { role: "full_admin" }));
    const admits = await t.run(async (ctx) => {
      const a = await TEST_ADMISSION.admitCapabilityCallWithCtx(ctx, { runId: runB.runId, attemptId: runB.attemptId, callIdempotencyKey: "c1", request: shiftsRequest() as never, now: TEST_NOW_BASE + 1 });
      const b = await TEST_ADMISSION.admitCapabilityCallWithCtx(ctx, { runId: runB.runId, attemptId: runB.attemptId, callIdempotencyKey: "c2", request: shiftsRequest({}) as never, now: TEST_NOW_BASE + 1 });
      return [a, b];
    });
    for (const admit of admits) {
      expect(admit.outcome).toBe("admitted");
      if (admit.outcome !== "admitted") continue;
      expect(admit.invocation.grantedProjections).toEqual([]);
      const response = await runPort(t, TEST_ADMISSION, admit.invocation);
      const release = await t.run((ctx) => TEST_ADMISSION.releaseCapabilityResultWithCtx(ctx, { callId: admit.callId, response, now: TEST_NOW_BASE + 2 }));
      expect(release.outcome).toBe("released");
      if (release.outcome !== "released") continue;
      for (const row of release.envelope.data as Record<string, unknown>[]) expect("revenue" in row).toBe(false);
    }
  });
});

describe("scenario 4 — only explicitly registered internal ports are reachable", () => {
  it("refuses dispatch to a generated port with no binding as a typed, recorded unavailable outcome", async () => {
    const t = convexTest(schema, modules);
    const { runA } = await seedTwoOperators(t);
    const partial = createDelegatedAdmission({
      ...TEST_GRANT_CONFIG,
      readPorts: createAgentReadPortRegistry({
        registry: TEST_REGISTRY,
        bindings: TEST_PORT_BINDINGS.filter((binding) => binding.portKey !== "ops.auditTrail"),
      }),
    });
    const result = await invoke(
      t,
      runA,
      { capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId, namespace: "ops.auditTrail", verb: "list", args: {} as never },
      { admission: partial },
    );
    expect(result.admit).toMatchObject({ outcome: "refused", result: { kind: "unavailable", reason: "port_unbound", retryable: false } });
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("unavailable");
  });

  it("gives the bridge no database, public-API, or ad hoc function reach", () => {
    for (const file of ["delegatedAdmission.ts", "grants.ts", "readPorts.ts"]) {
      const source = readFileSync(path.join(HARNESS_DIR, file), "utf8");
      expect(source, file).not.toMatch(/import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*["']\.\.\/_generated\/api["']/);
      expect(source, file).not.toMatch(/\bmakeFunctionReference\b/);
      expect(source, file).not.toMatch(/\banyApi\b/);
    }
    // A program never receives a ctx: the port invocation carries ids and args only.
    const invocationKeys = Object.keys(TEST_ADMISSION.invocationShape);
    expect(invocationKeys).not.toContain("db");
    expect(invocationKeys).not.toContain("scope");
  });

  it("lets only the admission composition root import the privileged generated registry", () => {
    const convexDir = path.dirname(HARNESS_DIR);
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "_generated") walk(path.join(dir, entry.name));
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const absolute = path.join(dir, entry.name);
        if (/agentHarness\/_generated\/registry/.test(readFileSync(absolute, "utf8"))) {
          importers.push(path.relative(convexDir, absolute).split(path.sep).join("/"));
        }
      }
    };
    walk(convexDir);
    expect(importers.sort()).toEqual(["platform/operationAdmission.ts"]);
  });
});

describe("scenario 5 — domain admission failure is typed, recorded once, never downgraded", () => {
  it("records one denied call per idempotency key, resumes on retry, and consults no other authority port", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA } = await seedTwoOperators(t);
    const demoSpy = vi.fn(TEST_AUTHORITY_PORTS.shared_demo.resolve);
    const spied = createDelegatedAdmission({
      ...TEST_GRANT_CONFIG,
      readPorts: TEST_ADMISSION.readPorts,
      authorityPorts: { ...TEST_AUTHORITY_PORTS, shared_demo: { ...TEST_AUTHORITY_PORTS.shared_demo, resolve: demoSpy } },
    });
    await t.run((ctx) => ctx.db.delete("organizationMember", alpha.membershipId!));

    const first = await invoke(t, runA, shiftsRequest(), { key: "same", admission: spied });
    const second = await invoke(t, runA, shiftsRequest(), { key: "same", admission: spied });
    expect(first.admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    expect(second.admit).toMatchObject({ outcome: "resumed", status: "denied" });
    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(calls).toHaveLength(1);
    expect(calls[0].error ?? calls[0].denial).toMatchObject({ code: expect.stringContaining("membership_revoked") });
    expect(demoSpy).not.toHaveBeenCalled();
  });

  it("settles an unavailable port, a failed port, and a contract-violating port once each without releasing data", async () => {
    const t = convexTest(schema, modules);
    const { runA } = await seedTwoOperators(t);

    TEST_PORT_BEHAVIOR.shifts = "unavailable";
    const unavailable = await invoke(t, runA, shiftsRequest(), { key: "unavailable" });
    expect(unavailable.release).toMatchObject({ outcome: "withheld", result: { kind: "unavailable", reason: "shift_source_offline", retryable: true } });

    TEST_PORT_BEHAVIOR.shifts = "leak_unknown_field";
    const leak = await invoke(t, runA, shiftsRequest(), { key: "leak" });
    expect(leak.response).toMatchObject({ kind: "failed", error: { code: "port_contract_violation" } });
    expect(leak.release).toMatchObject({ outcome: "withheld", result: { kind: "failed" } });

    TEST_PORT_BEHAVIOR.shifts = "leak_raw_id";
    const raw = await invoke(t, runA, shiftsRequest(), { key: "raw" });
    expect(raw.release).toMatchObject({ outcome: "withheld", result: { kind: "failed" } });

    TEST_PORT_BEHAVIOR.shifts = "exceed_bounds";
    const bounds = await invoke(t, runA, shiftsRequest({}), { key: "bounds" });
    expect(bounds.release).toMatchObject({ outcome: "withheld", result: { kind: "failed" } });

    TEST_PORT_BEHAVIOR.shifts = "throw";
    const admit = await t.run((ctx) =>
      TEST_ADMISSION.admitCapabilityCallWithCtx(ctx, { runId: runA.runId, attemptId: runA.attemptId, callIdempotencyKey: "throw", request: shiftsRequest() as never, now: TEST_NOW_BASE + 1 }),
    );
    expect(admit.outcome).toBe("admitted");
    if (admit.outcome !== "admitted") return;
    await expect(runPort(t, TEST_ADMISSION, admit.invocation)).rejects.toThrow(/shift source exploded/);
    const failed = await t.run((ctx) =>
      TEST_ADMISSION.releaseCapabilityResultWithCtx(ctx, {
        callId: admit.callId,
        response: { kind: "failed", error: { code: "port_threw", message: "shift source exploded" } },
        now: TEST_NOW_BASE + 2,
      }),
    );
    expect(failed).toMatchObject({ outcome: "withheld", result: { kind: "failed" } });

    const calls = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(calls.map((c) => [c.callIdempotencyKey, c.status, c.replayPayloadId === undefined])).toEqual([
      ["unavailable", "unavailable", true],
      ["leak", "failed", true],
      ["raw", "failed", true],
      ["bounds", "failed", true],
      ["throw", "failed", true],
    ]);
    expect(calls[0].charged.rows).toBe(0);
  });
});

describe("scenario 6 — the delegated seam leaves public ingress untouched", () => {
  it("adds no actor kind to the public admission union", () => {
    expectTypeOf<OperationActorKind>().toEqualTypeOf<"normal_user" | "shared_demo" | "storefront_customer" | "public">();
  });
});

describe("scenario 7 — revocation between dispatch and release", () => {
  it("withholds the result from the model, keeps redacted evidence only, and blocks citations and completion", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA } = await seedTwoOperators(t);
    const raced = await invoke(t, runA, shiftsRequest(), {
      key: "raced",
      between: async () => {
        await t.run((ctx) => ctx.db.delete("organizationMember", alpha.membershipId!));
      },
    });
    expect(raced.response).toMatchObject({ kind: "envelope" });
    expect(raced.release).toMatchObject({ outcome: "withheld", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    expect(JSON.stringify(raced.release)).not.toContain("alpha store");

    const [call] = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(call.status).toBe("canceled");
    expect(call.replayPayloadId).toBeUndefined();
    expect(call.outputOmittedReason).toBe("authorization_revoked_before_release");
    expect(call.resultHash).toEqual(expect.any(String));
    expect(call.delegation).toMatchObject({ admission: "authorized", release: { verdict: "withheld", reason: "membership_revoked" } });
    expect(JSON.stringify(call)).not.toContain("alpha store");
    expect(call.charged.calls).toBe(1);

    const citations = await t.run((ctx) => TEST_ADMISSION.reauthorizeCitationsWithCtx(ctx, { runId: runA.runId, callIds: [call._id], now: TEST_NOW_BASE + 30 }));
    expect(citations).toMatchObject({ kind: "refused" });
    const completion = await t.run((ctx) => TEST_ADMISSION.reauthorizeCompletionWithCtx(ctx, { runId: runA.runId, now: TEST_NOW_BASE + 31 }));
    expect(completion).toMatchObject({ kind: "refused", reason: "membership_revoked" });
  });

  it("re-strips a released result when authority shrank between dispatch and release, and refuses a citation for a later-disabled capability", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA } = await seedTwoOperators(t);
    const shrunk = await invoke(t, runA, shiftsRequest(), {
      key: "shrunk",
      between: async () => {
        await t.run((ctx) => ctx.db.patch("organizationMember", alpha.membershipId!, { role: "pos_only" }));
      },
    });
    expect(shrunk.response).toMatchObject({ kind: "envelope" });
    const rows = releasedData(shrunk) as Record<string, unknown>[];
    expect(Object.keys(rows[0]).sort()).toEqual(["label", "shiftRef", "status"]);
    if (shrunk.release?.outcome !== "released") throw new Error("expected release");
    expect(shrunk.release.authorityShrunk).toBe(true);
    const [call] = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(call.status).toBe("succeeded");
    expect(call.delegation?.release).toMatchObject({ verdict: "released", authorityShrunk: true });

    const ok = await t.run((ctx) => TEST_ADMISSION.reauthorizeCitationsWithCtx(ctx, { runId: runA.runId, callIds: [call._id], now: TEST_NOW_BASE + 20 }));
    expect(ok).toMatchObject({ kind: "authorized" });
    TEST_ENABLEMENT.narrow({ capabilities: { [SHIFTS_MANIFEST.capabilityId]: "disabled" } });
    const disabled = await t.run((ctx) => TEST_ADMISSION.reauthorizeCitationsWithCtx(ctx, { runId: runA.runId, callIds: [call._id], now: TEST_NOW_BASE + 21 }));
    expect(disabled).toMatchObject({ kind: "refused", result: { kind: "unauthorized", code: "capability_disabled" } });
    const foreign = await t.run(async (ctx) => {
      const other = await seedDelegatedOperator(ctx, "other", { role: "full_admin" });
      const otherRun = await seedExecutingRun(ctx, other);
      return TEST_ADMISSION.reauthorizeCitationsWithCtx(ctx, { runId: otherRun.runId, callIds: [call._id], now: TEST_NOW_BASE + 22 });
    });
    expect(foreign).toMatchObject({ kind: "refused", reason: "call_not_owned_by_run" });
  });

  it("refuses inside the port query itself when authority is revoked between admission and dispatch", async () => {
    const t = convexTest(schema, modules);
    const { alpha, runA } = await seedTwoOperators(t);
    const admit = await t.run((ctx) =>
      TEST_ADMISSION.admitCapabilityCallWithCtx(ctx, { runId: runA.runId, attemptId: runA.attemptId, callIdempotencyKey: "race-dispatch", request: shiftsRequest() as never, now: TEST_NOW_BASE + 1 }),
    );
    expect(admit.outcome).toBe("admitted");
    if (admit.outcome !== "admitted") return;
    await t.run((ctx) => ctx.db.delete("organizationMember", alpha.membershipId!));
    const response = await runPort(t, TEST_ADMISSION, admit.invocation);
    expect(response).toMatchObject({ kind: "refused", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    const release = await t.run((ctx) => TEST_ADMISSION.releaseCapabilityResultWithCtx(ctx, { callId: admit.callId, response, now: TEST_NOW_BASE + 2 }));
    expect(release).toMatchObject({ outcome: "withheld", result: { kind: "unauthorized" } });
    const [call] = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    // Already dispatched, so the lifecycle clamps it as canceled; the reason is the port's refusal.
    expect(call.status).toBe("canceled");
    expect(call.error).toMatchObject({ code: "membership_revoked" });
    expect(call.delegation?.release).toMatchObject({ verdict: "withheld", reason: "membership_revoked" });
    expect(call.replayPayloadId).toBeUndefined();
  });

  it("refuses a forged invocation that names a call the run never admitted", async () => {
    const t = convexTest(schema, modules);
    const { runA, runB } = await seedTwoOperators(t);
    const admit = await t.run((ctx) =>
      TEST_ADMISSION.admitCapabilityCallWithCtx(ctx, { runId: runA.runId, attemptId: runA.attemptId, callIdempotencyKey: "forge", request: shiftsRequest() as never, now: TEST_NOW_BASE + 1 }),
    );
    if (admit.outcome !== "admitted") throw new Error(admit.outcome);
    const forged = await runPort(t, TEST_ADMISSION, { ...admit.invocation, runId: runB.runId, grantId: runB.grantId, grantedProjections: ["financials"] });
    expect(forged).toMatchObject({ kind: "refused", result: { kind: "denied" } });
    const widened = await runPort(t, TEST_ADMISSION, { ...admit.invocation, grantedProjections: ["financials"] });
    // The port recomputes projections from the grant, so the forged list changes nothing.
    expect(widened).toMatchObject({ kind: "envelope" });
    if (widened.kind !== "envelope") return;
    expect(Object.keys((widened.envelope.data as Record<string, unknown>[])[0]).sort()).toEqual(["label", "managerNotes", "revenue", "shiftRef", "status"]);
  });
});

describe("shared-demo operator", () => {
  it("reads through the same seam clamped to the demo grant and stops the moment the session expires", async () => {
    const t = convexTest(schema, modules);
    const { demo, run } = await t.run(async (ctx) => {
      const demo = await seedDelegatedOperator(ctx, "demo", { role: "full_admin", operationalRoles: ["manager"] });
      const authUserId = await ctx.db.insert("users", { email: "demo@test" });
      await ctx.db.insert("sharedDemoPrincipal", {
        authUserId,
        athenaUserId: demo.userId,
        organizationId: demo.organizationId,
        storeId: demo.storeId,
        admissionExpiresAt: TEST_NOW_BASE + 1_000,
        updatedAt: TEST_NOW_BASE,
      });
      return { demo, run: await seedExecutingRun(ctx, demo, { operatorKind: "shared_demo", authUserId }) };
    });
    const ok = await invoke(t, run, shiftsRequest(), { key: "demo-1", now: TEST_NOW_BASE + 10 });
    const rows = releasedData(ok) as Record<string, unknown>[];
    expect(rows[0].label).toBe("demo store evening");
    expect("revenue" in rows[0]).toBe(true);
    const expired = await invoke(t, run, shiftsRequest(), { key: "demo-2", now: TEST_NOW_BASE + 5_000 });
    expect(expired.admit).toMatchObject({ outcome: "refused", result: { kind: "unauthorized", code: "unauthorized_scope" } });
    expect(demo.storeId).toBeDefined();
  });
});

describe("composition root wiring", () => {
  it("binds every generated port, and refuses a grant on the unpublished synthetic profile through the real registry", async () => {
    const root = await import("../platform/operationAdmission");
    expect(root.agentReadPorts.listUnboundPorts()).toEqual([]);
    const t = convexTest(schema, modules);
    const outcome = await t.run(async (ctx) => {
      const admin = await seedDelegatedOperator(ctx, "alpha", { role: "full_admin" });
      return root.materializeAgentRunGrantWithCtx(ctx, {
        operator: { kind: "normal_user", athenaUserId: admin.userId },
        profileId: "organization_overview",
        organizationId: admin.organizationId,
        storeId: admin.storeId,
        promptPayloadHash: "sha256:prompt",
        runIdempotencyKey: "turn-1",
        now: TEST_NOW_BASE,
      });
    });
    expect(outcome).toMatchObject({ kind: "refused", stage: "enablement", reason: "profile_unpublished" });
  });

  it("exposes the bound executor and runtime-host surface and the port definer from the composition root", async () => {
    const root = await import("../platform/operationAdmission");
    for (const name of [
      "materializeAgentRunGrantWithCtx",
      "reauthorizeAgentGrantWithCtx",
      "admitAgentCapabilityCallWithCtx",
      "releaseAgentCapabilityResultWithCtx",
      "reauthorizeAgentCitationsWithCtx",
      "reauthorizeAgentCompletionWithCtx",
      "describeAgentGrantForModel",
      "defineAgentReadPortQuery",
    ] as const) {
      expect(typeof root[name], name).toBe("function");
    }
    expectTypeOf<DelegatedCallAdmission["outcome"]>().toEqualTypeOf<"admitted" | "resumed" | "refused">();
  });
});

describe("store-day snapshot (get verb)", () => {
  it("returns the projected snapshot for an admin and the unprojected snapshot for a cashier", async () => {
    const t = convexTest(schema, modules);
    const { runA, runB } = await seedTwoOperators(t);
    const request = { capabilityId: STORE_DAY_MANIFEST.capabilityId, namespace: "ops.storeDay", verb: "get" as const, args: { operatingDate: "2026-08-21" } as never };
    const a = releasedData(await invoke(t, runA, request)) as Record<string, unknown>;
    const b = releasedData(await invoke(t, runB, request)) as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(["cashVariance", "operatingDate", "status"]);
    expect(Object.keys(b).sort()).toEqual(["operatingDate", "status"]);
    const [callA] = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    expect(callA).toMatchObject({ status: "succeeded", delegation: { portKey: "ops.storeDay", admission: "authorized" } });
    expect(callA.sourceRefs[0]).toMatchObject({ table: "opaque_source", id: expect.stringMatching(/^source:/) });
  });
});

describe("delegation evidence on call rows", () => {
  it("records delegated provenance, grant digest, epoch, and port identity without any result data", async () => {
    const t = convexTest(schema, modules);
    const { runA } = await seedTwoOperators(t);
    await invoke(t, runA, shiftsRequest(), { key: "evidence" });
    const [call] = await t.run((ctx) => listCapabilityCallsForRun(ctx, runA.runId));
    const grant = await t.run((ctx) => ctx.db.get("agentRunGrant", runA.grantId) as Promise<Doc<"agentRunGrant">>);
    expect(call.delegation).toMatchObject({
      grantId: runA.grantId,
      grantDigest: grant.grantDigest,
      portKey: "ops.shifts",
      handlerPath: "agentHarness/testPorts:listShifts",
      operatorKind: "normal_user",
      actorRef: `athenaUser:${grant.delegation!.athenaUserId}`,
      authorizationEpoch: 0,
      grantedProjections: ["financials", "managerNotes"],
      admission: "authorized",
      release: { verdict: "released", authorityShrunk: false },
    });
    expect(JSON.stringify(call.delegation)).not.toContain("alpha store");
  });
});
