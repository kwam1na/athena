import { beforeEach, describe, expect, it } from "vitest";
import { resolveEffectiveConfig } from "../src/config";
import { SymphonyError } from "../src/errors";
import { validateDispatchPreflight } from "../src/validate";

describe("resolveEffectiveConfig", () => {
  const original = process.env.LINEAR_API_KEY;

  beforeEach(() => {
    process.env.LINEAR_API_KEY = original;
  });

  it("applies defaults", () => {
    const config = resolveEffectiveConfig({});
    expect(config.polling.intervalMs).toBe(30000);
    expect(config.workspace.root).toContain("symphony_workspaces");
    expect(config.codex.command).toBe("codex app-server");
    expect(config.codex.clientName).toBe("symphony");
    expect(typeof config.codex.clientVersion).toBe("string");
    expect(config.codex.clientVersion.length).toBeGreaterThan(0);
    expect(config.codex.clientCapabilities).toEqual({});
    expect(config.agent.maxConcurrentAgents).toBe(10);
    expect(config.tracker.handoffState).toBe("Human Review");
  });

  it("resolves tracker api key from env indirection", () => {
    process.env.LINEAR_API_KEY = "test-key";

    const config = resolveEffectiveConfig({
      tracker: {
        kind: "linear",
        api_key: "$LINEAR_API_KEY",
        project_slug: "ATH",
      },
    });

    expect(config.tracker.apiKey).toBe("test-key");
  });

  it("normalizes per-state limits with lowercase keys", () => {
    const config = resolveEffectiveConfig({
      agent: {
        max_concurrent_agents_by_state: {
          Todo: 2,
          "In Progress": "4",
          Invalid: 0,
        },
      },
    });

    expect(config.agent.maxConcurrentAgentsByState).toEqual({
      todo: 2,
      "in progress": 4,
    });
  });

  it("supports codex client metadata overrides", () => {
    const config = resolveEffectiveConfig({
      codex: {
        client_name: "athena-symphony",
        client_version: "2.4.6",
        client_capabilities: {
          tools: true,
        },
      },
    });

    expect(config.codex.clientName).toBe("athena-symphony");
    expect(config.codex.clientVersion).toBe("2.4.6");
    expect(config.codex.clientCapabilities).toEqual({ tools: true });
  });

  it("supports tracker handoff state override", () => {
    const config = resolveEffectiveConfig({
      tracker: {
        handoff_state: "Ready for Review",
      },
    });

    expect(config.tracker.handoffState).toBe("Ready for Review");
  });
});

describe("validateDispatchPreflight", () => {
  it("fails when required dispatch fields are missing", () => {
    const config = resolveEffectiveConfig({
      tracker: {
        kind: "linear",
      },
    });

    expect(() => validateDispatchPreflight(config)).toThrowError(SymphonyError);

    try {
      validateDispatchPreflight(config);
    } catch (error) {
      expect((error as SymphonyError).code).toBe("missing_tracker_api_key");
    }
  });

  it("passes when required fields exist", () => {
    const config = resolveEffectiveConfig({
      tracker: {
        kind: "linear",
        api_key: "abc",
        project_slug: "ATH",
      },
      codex: {
        command: "codex app-server",
      },
    });

    expect(() => validateDispatchPreflight(config)).not.toThrow();
  });
});
