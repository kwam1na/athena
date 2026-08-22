import { describe, expect, it } from "bun:test";

import { buildFenceInvocation, evaluateFenceResult, parseFenceArgs } from "./agent-harness-fence";
import { buildSwitchCommand, parseSwitchArgs } from "./agent-harness-switch";

describe("agent-harness:fence", () => {
  it("requires a reason and validates profile ids against the local registry", () => {
    expect(parseFenceArgs([])).toEqual({ error: "--reason is required (what is being deployed)." });
    expect(parseFenceArgs(["--bogus"])).toEqual({ error: "Unknown argument: --bogus" });
    const options = parseFenceArgs(["--reason", "deploy v2", "--profile", "daily_operations", "--dry-run"]);
    expect(options).toEqual({ reason: "deploy v2", profileIds: ["daily_operations"], dryRun: true, actorRef: undefined });
    if ("error" in options) throw new Error(options.error);
    expect(buildFenceInvocation(options, "fnv1a64:abc", ["organization_overview"])).toEqual({ error: "Unknown profile(s) in the local registry: daily_operations" });
  });

  it("fences every registered profile by default with the local artifact digest, through one internal mutation", () => {
    const options = parseFenceArgs(["--reason", "deploy v2"]);
    if ("error" in options) throw new Error(options.error);
    const invocation = buildFenceInvocation(options, "fnv1a64:abc", ["organization_overview", "daily_operations"]);
    if ("error" in invocation) throw new Error(invocation.error);
    expect(invocation.command.slice(0, 4)).toEqual(["bunx", "convex", "run", "agentHarness/deploymentState:fenceForDeploy"]);
    expect(JSON.parse(invocation.command[4])).toEqual({ nextDigest: "fnv1a64:abc", profileIds: ["organization_overview", "daily_operations"], reason: "deploy v2" });
  });

  it("treats a rejected or missing epoch result as a failed fence (the deploy must abort)", () => {
    expect(evaluateFenceResult(null).ok).toBe(false);
    expect(evaluateFenceResult({ epoch: { outcome: "rejected", reason: "unknown_profile" }, disabledProfiles: [] })).toMatchObject({ ok: false });
    expect(evaluateFenceResult({ epoch: { outcome: "advanced", epoch: 3, digest: "fnv1a64:abc" }, disabledProfiles: ["daily_operations"], canceledRuns: 2 })).toMatchObject({ ok: true });
    expect(evaluateFenceResult({ epoch: { outcome: "unchanged", epoch: 3, digest: "fnv1a64:abc" }, disabledProfiles: ["daily_operations"] })).toMatchObject({ ok: true });
  });
});

describe("agent-harness:switch", () => {
  it("parses enable/disable/status and builds the internal mutation invocation", () => {
    expect(parseSwitchArgs(["--status"])).toEqual({ mode: "status" });
    expect(parseSwitchArgs(["--profile", "daily_operations"])).toEqual({ error: "Pass exactly one of --enable or --disable." });
    expect(parseSwitchArgs(["--profile", "daily_operations", "--enable"])).toEqual({ error: "--reason is required." });
    const options = parseSwitchArgs(["--profile", "daily_operations", "--enable", "--reason", "smoke passed"]);
    expect(options).toEqual({ mode: "set", profileId: "daily_operations", state: "enabled", reason: "smoke passed", actorRef: undefined });
    expect(buildSwitchCommand(options as never).slice(3)).toEqual(["agentHarness/deploymentState:setProfileEnablement", JSON.stringify({ profileId: "daily_operations", state: "enabled", reason: "smoke passed" })]);
    expect(buildSwitchCommand({ mode: "status" }).slice(3)).toEqual(["agentHarness/deploymentState:describeDeploymentState", "{}"]);
  });
});
