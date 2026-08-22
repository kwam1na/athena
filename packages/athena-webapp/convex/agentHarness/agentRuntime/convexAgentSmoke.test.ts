// @vitest-environment node
/**
 * The deployed smoke action (`convexAgentSmoke:run`) exercised end to end
 * under convex-test with the Agent component registered: a Convex Agent turn
 * through the adapter, an Athena tool through the QuickJS sandbox bridge,
 * projection, and cleanup. The same action is what `bunx convex run
 * agentHarness/agentRuntime/convexAgentSmoke:run` executes on the Node 22
 * deployment.
 */
import { anyApi, type FunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { createConvexTestBackend } from "./convexAgent.contractHarness";

type SmokeReport = {
  node: string;
  adapter: { adapterKind: string; adapterVersion: string; protocolVersion: string };
  programRuntime: { kind: string; startupMs: number };
  events: string[];
  turnOutcome?: { outcome: string; narrative?: string };
  dispatch: string[];
  programOutcomes: Array<{ status: string; output?: unknown; diagnostics?: { hostCalls: number; maxInFlight: number } }>;
  projection: { kind: string; replayed?: boolean };
  cleanup: { ok: boolean; deleted?: string[] };
  usage: { tokens: { input: number; output: number }; streams: number };
  timings: { firstProgressMs: number | null; completionMs: number; totalMs: number };
};

describe("convexAgentSmoke:run (local execution of the deployed smoke action)", () => {
  it("runs a Convex Agent turn through the adapter and a program through the sandbox bridge", async () => {
    const t = createConvexTestBackend();
    // Typed by hand until a successful push regenerates `internal` with this module.
    type SmokeRun = FunctionReference<"action", "internal", { model: "mock" | "openai"; modelId?: string }, SmokeReport>;
    const smokeRun = (anyApi as unknown as { agentHarness: { agentRuntime: { convexAgentSmoke: { run: SmokeRun } } } }).agentHarness
      .agentRuntime.convexAgentSmoke.run;
    const report = await t.action(smokeRun, { model: "mock" });

    expect(report.node).toMatch(/^v\d+/);
    expect(report.adapter.adapterKind).toBe("convex_agent");
    expect(report.programRuntime.kind).toBe("quickjs_wasm");
    // Usage is reported per model step once the step (including its tool execution) ends.
    expect(report.events).toEqual(["turn_started", "tool_call_requested", "tool_call_completed", "usage", "usage", "turn_completed", "completion_projected"]);
    expect(report.turnOutcome).toMatchObject({ outcome: "completed" });
    expect(report.dispatch).toEqual(["success"]);
    expect(report.programOutcomes).toHaveLength(1);
    expect(report.programOutcomes[0]).toMatchObject({ status: "completed", output: { open: true, queued: 2 }, diagnostics: { hostCalls: 2, maxInFlight: 2 } });
    expect(report.projection).toMatchObject({ kind: "projected", replayed: false });
    expect(report.cleanup.ok).toBe(true);
    expect(report.usage).toEqual({ tokens: { input: 120, output: 24, cachedInput: 0, reasoning: 0 }, streams: 2 });
    expect(report.timings.firstProgressMs).not.toBeNull();
    expect(report.timings.completionMs).toBeGreaterThanOrEqual(0);
    console.log("SMOKE_LOCAL", JSON.stringify({ node: report.node, timings: report.timings, programRuntime: report.programRuntime }));
  });
});
