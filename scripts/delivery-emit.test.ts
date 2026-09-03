import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HARNESS_CLI_ENTRY,
  PAYLOAD_ENV_VAR,
  buildEmitArgs,
} from "./delivery-emit";

describe("buildEmitArgs", () => {
  it("passes the payload to --json as one argument", () => {
    expect(
      buildEmitArgs(["decision.recorded"], '{"fork":"branch name","choice":"x"}')
    ).toEqual([
      "emit",
      "decision.recorded",
      "--json",
      '{"fork":"branch name","choice":"x"}',
    ]);
  });

  it("forwards the CLI's own flags after the kind", () => {
    expect(buildEmitArgs(["run.ended", "--run", "run-abc"], undefined)).toEqual([
      "emit",
      "run.ended",
      "--run",
      "run-abc",
      "--json",
      "{}",
    ]);
  });

  it("defaults an absent or blank payload to an empty object", () => {
    expect(buildEmitArgs(["posture.declared"], "  ")).toContain("{}");
  });

  it("requires a kind", () => {
    expect(() => buildEmitArgs([], "{}")).toThrow(/Usage:/);
  });

  it("rejects a caller-supplied --json rather than silently overriding it", () => {
    expect(() =>
      buildEmitArgs(["run.started", "--json", '{"host":"x"}'], undefined)
    ).toThrow(`The payload travels in ${PAYLOAD_ENV_VAR}, not in --json.`);
  });

  it("rejects a payload that is not JSON", () => {
    expect(() => buildEmitArgs(["run.started"], "posture=sensor-only")).toThrow(
      `${PAYLOAD_ENV_VAR} is not valid JSON.`
    );
  });
});

describe("the wrapper's declared entrypoints", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");

  it("resolves the harness CLI entry the wrapper spawns", () => {
    // The pinned package publishes no `bin` and its exports map covers only
    // `.`, so this deep path is the wrapper's real coupling to the dependency.
    // A pin bump that relocates the module would otherwise fail only at
    // runtime, and silently: the CLI's own direct-invocation guard exits 0
    // without emitting when it is loaded through any other module path.
    expect(existsSync(path.join(repoRoot, HARNESS_CLI_ENTRY))).toBe(true);
  });

  it("registers both delivery commands AGENTS.md tells agents to run", () => {
    const scripts = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ).scripts;
    expect(scripts["delivery:emit"]).toBe("bun scripts/delivery-emit.ts");
    expect(scripts["agent-skills:install"]).toBe(
      "bun scripts/agent-skills-install.ts"
    );
  });
});
