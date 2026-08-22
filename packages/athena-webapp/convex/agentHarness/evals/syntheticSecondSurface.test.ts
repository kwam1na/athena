// @vitest-environment node
/// <reference types="vite/client" />
/**
 * The synthetic second profile, end to end, on the same kernel.
 *
 * `organization_overview` is deliberately unlike the first real profile: it is
 * organization-scoped rather than store-scoped, mixes a snapshot `get` with
 * cursor-bounded `list`s, mounts full screen, and has its own thread key,
 * starter intents, and source destinations. The point of running it here is
 * that it needs no kernel change to work: the same registry, admission,
 * executor, sandbox, budgets, evidence, and citations carry it.
 *
 * It also stays UNPUBLISHED for operators. Publication is a separate decision
 * from working, and this suite is the evidence that it works.
 */
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../../schema";
import { AGENT_GENERATED_REGISTRY } from "../_generated/registry";
import {
  createProgramExecutor,
  type AgentExecutorCtx,
  type AgentProgramExecutor,
  type AgentProgramExecutorConfig,
} from "../executor";
import { createQuickJsProgramRuntime } from "../programRuntime/quickJsRuntime";
import type { AgentProgramRuntime } from "../programRuntime/types";
import { SYNTHETIC_SECOND_SURFACE_PROFILE, SYNTHETIC_SECOND_SURFACE_PROFILE_ID } from "../profiles/syntheticSecondSurface";
import { FIXTURE_NOW, seedDailyOperationsStore } from "./dailyOperations.fixture";
import {
  DIRECT_HARNESS_ADMISSION,
  DIRECT_HARNESS_SEAMS,
  DIRECT_HARNESS_SEAM_REFS,
  startDirectHarnessRunWithCtx,
} from "./directHarness";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../../")
      ? path.replace(/^\.\.\/\.\.\//, "./")
      : path.startsWith("../")
        ? path.replace(/^\.\.\//, "./agentHarness/")
        : path.replace(/^\.\//, "./agentHarness/evals/"),
    loader,
  ]),
);

type Harness = TestConvex<typeof schema>;
type AnyCall = (reference: unknown, args: unknown) => Promise<unknown>;

let runtimePromise: Promise<AgentProgramRuntime> | undefined;
const runtime = () => (runtimePromise ??= createQuickJsProgramRuntime());

function executorCtx(t: Harness): AgentExecutorCtx {
  return {
    runQuery: (reference, args) => (t.query as unknown as AnyCall)(reference, args),
    runMutation: (reference, args) => (t.mutation as unknown as AnyCall)(reference, args),
  };
}

async function executor(): Promise<AgentProgramExecutor> {
  return createProgramExecutor({
    runtime: await runtime(),
    seams: DIRECT_HARNESS_SEAM_REFS,
    dispatchReadPort: ((ctx: never, invocation: never) =>
      DIRECT_HARNESS_ADMISSION.dispatchReadPort(ctx, invocation)) as AgentProgramExecutorConfig["dispatchReadPort"],
    clock: () => FIXTURE_NOW,
    heartbeatMs: 10_000,
    ceilingOverrides: { maxElapsedMs: 10_000 },
  });
}

const FLEET_PROGRAM = `
const stores = await athena.fleet.stores.list({});
const teams = await athena.directory.teams.list({});
const rows = stores.kind === "result" ? stores.envelope.data : [];
const health = rows.length > 0
  ? await athena.fleet.storeHealth.get({ storeRef: rows[0].storeRef })
  : { kind: "unavailable" };
return {
  storeOutcome: stores.kind,
  teamOutcome: teams.kind,
  healthOutcome: health.kind,
  storeCount: rows.length,
  storeKeys: rows.length > 0 ? Object.keys(rows[0]).sort() : [],
  healthBands: rows.map((row) => row.health),
  teamNames: teams.kind === "result" ? teams.envelope.data.map((team) => team.name) : [],
  uptimePercent: health.kind === "result" ? health.envelope.data.uptimePercent : -1,
  incidentNotesState: health.kind === "result" ? health.envelope.data.incidentNotes.state : "absent",
  healthFreshness: health.kind === "result" ? health.envelope.freshness.class : "unavailable",
};
`;

/** Health for a store the operator's organization does not own. */
const FOREIGN_PROGRAM = (foreignRef: string) => `
const health = await athena.fleet.storeHealth.get({ storeRef: ${JSON.stringify(foreignRef)} });
return {
  outcome: health.kind,
  data: health.kind === "result" ? health.envelope.data : null,
  completeness: health.kind === "result" ? health.envelope.completeness.status : "unavailable",
};
`;

async function seedRun(t: Harness, key: string) {
  return t.run(async (ctx) => {
    const fixture = await seedDailyOperationsStore(ctx, { slug: key });
    const started = await startDirectHarnessRunWithCtx(ctx, {
      profileId: SYNTHETIC_SECOND_SURFACE_PROFILE_ID,
      athenaUserId: fixture.userId,
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
      runIdempotencyKey: `synthetic-${key}`,
      now: FIXTURE_NOW,
    });
    if (started.kind !== "running") throw new Error(JSON.stringify(started));
    return { fixture, started };
  });
}

describe("synthetic second surface", () => {
  it("stays unpublished for operators while being fully exercisable", () => {
    expect(SYNTHETIC_SECOND_SURFACE_PROFILE.lifecycle).toBe("unpublished");
    expect(AGENT_GENERATED_REGISTRY.enablement.profiles[SYNTHETIC_SECOND_SURFACE_PROFILE_ID]).toBe(
      "unpublished",
    );
    // Organization scope, not store scope: the second profile is structurally
    // different from the first, which is what makes it a real test.
    expect(SYNTHETIC_SECOND_SURFACE_PROFILE.scope.kind).toBe("organization");
    expect(SYNTHETIC_SECOND_SURFACE_PROFILE.presentation.mountMode).toBe("full_screen_sheet");
  });

  it("runs an organization-scoped program end to end on the same kernel", async () => {
    const t = convexTest(schema, modules);
    const { started } = await seedRun(t, "fleet");
    const result = await (await executor()).executeProgram(executorCtx(t), {
      runId: started.runId,
      attemptIdempotencyKey: "synthetic-fleet-1",
      source: FLEET_PROGRAM,
    });
    expect(result.outcome, JSON.stringify(result).slice(0, 1_500)).toBe("result");
    if (result.outcome !== "result") throw new Error("unreachable");

    const output = result.result.output as Record<string, unknown>;
    expect(output.storeOutcome).toBe("result");
    expect(output.teamOutcome).toBe("result");
    expect(output.healthOutcome).toBe("result");
    expect(output.storeCount).toBe(1);
    expect(output.storeKeys).toEqual(["health", "name", "region", "storeRef"]);
    // No terminal has ever reported for the seeded store, so no terminal is
    // online — the honest reading of the band, not a cheerful default.
    expect(output.healthBands).toEqual(["offline"]);
    expect(output.teamNames).toEqual(["Managers", "Cashiers", "Support"]);
    expect(output.uptimePercent).toBe(0);
    // The projection is granted (full admin with platform health), and there
    // is no incident to report, so the value is explicitly unknown, not zero.
    expect(output.incidentNotesState).toBe("unknown");
    expect(output.healthFreshness).toBe("derived");

    expect(result.calls.map((call) => call.namespace)).toEqual([
      "fleet.stores",
      "directory.teams",
      "fleet.storeHealth",
    ]);
    expect(result.calls.every((call) => call.outcome === "result")).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.providerEgress.state).toBe("committed");
  });

  it("cannot describe a store in another organization, even with a well-formed reference", async () => {
    const t = convexTest(schema, modules);
    const { started } = await seedRun(t, "home");
    // A second organization with its own store; its ref is minted under that
    // organization's scope, so this run can neither unmask nor resolve it.
    const foreignRef = await t.run(async (ctx) => {
      const other = await seedDailyOperationsStore(ctx, { slug: "foreign" });
      const { mintAgentResourceRef } = await import("../../lib/agentCapabilitySupport");
      return mintAgentResourceRef("fleet_store", String(other.organizationId), String(other.storeId));
    });

    const result = await (await executor()).executeProgram(executorCtx(t), {
      runId: started.runId,
      attemptIdempotencyKey: "synthetic-foreign-1",
      source: FOREIGN_PROGRAM(foreignRef),
    });
    expect(result.outcome, JSON.stringify(result).slice(0, 3_000)).toBe("result");
    if (result.outcome !== "result") throw new Error("unreachable");
    const output = result.result.output as Record<string, unknown>;
    expect(output.outcome).toBe("result");
    // Structurally absent, never zeroed, and indistinguishable from a store
    // that does not exist at all.
    expect(output.data).toEqual({});
    // Both declared sources are `unavailable`, which the envelope aggregates
    // as `partial` — never as a complete answer.
    expect(output.completeness).toBe("partial");

    // The home organization's own roster never contains the other store.
    const home = await (await executor()).executeProgram(executorCtx(t), {
      runId: started.runId,
      attemptIdempotencyKey: "synthetic-home-1",
      source: FLEET_PROGRAM,
    });
    if (home.outcome !== "result") throw new Error(JSON.stringify(home).slice(0, 800));
    expect((home.result.output as Record<string, unknown>).storeCount).toBe(1);
  });

  it("completes with claim-support evidence from the manifest's extractor", async () => {
    const t = convexTest(schema, modules);
    const { started } = await seedRun(t, "evidence");
    const result = await (await executor()).executeProgram(executorCtx(t), {
      runId: started.runId,
      attemptIdempotencyKey: "synthetic-evidence-1",
      source: FLEET_PROGRAM,
    });
    if (result.outcome !== "result") throw new Error(JSON.stringify(result).slice(0, 1_200));
    const healthCitation = result.citations.find((citation) => citation.namespace === "fleet.storeHealth");
    expect(healthCitation).toBeDefined();

    const completion = await t.run((ctx) =>
      DIRECT_HARNESS_SEAMS.completeRunWithCtx(ctx, {
        runId: started.runId,
        idempotencyKey: "synthetic-complete",
        citedAttemptRefs: [result.attemptRef],
        citations: [{ ref: healthCitation!.citation }],
        artifact: { title: "Fleet overview", payload: { headline: "one store, offline" } },
        now: FIXTURE_NOW,
      }),
    );
    expect(completion.outcome, JSON.stringify(completion).slice(0, 600)).toBe("completed");
    if (completion.outcome !== "completed") throw new Error("unreachable");
    expect(completion.citations.map((citation) => citation.support)).toEqual(["claim_support"]);
  });
});
