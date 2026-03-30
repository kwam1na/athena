import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { EffectiveConfig, WorkflowConfigMap } from "./types";

const defaultActiveStates = ["Todo", "In Progress"];
const defaultTerminalStates = ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"];

export function resolveEffectiveConfig(config: WorkflowConfigMap): EffectiveConfig {
  const tracker = asObject(config.tracker);
  const polling = asObject(config.polling);
  const workspace = asObject(config.workspace);
  const hooks = asObject(config.hooks);
  const agent = asObject(config.agent);
  const codex = asObject(config.codex);

  const trackerKind = asString(tracker.kind) ?? "";
  const trackerEndpoint =
    asString(tracker.endpoint) ??
    (trackerKind === "linear" ? "https://api.linear.app/graphql" : "https://api.linear.app/graphql");

  const trackerApiKey = resolveEnvReference(asString(tracker.api_key));
  const trackerProjectSlug = asString(tracker.project_slug);
  const trackerHandoffState = asString(tracker.handoff_state)?.trim() || "Human Review";

  return {
    tracker: {
      kind: trackerKind,
      endpoint: trackerEndpoint,
      apiKey: trackerApiKey || undefined,
      projectSlug: trackerProjectSlug || undefined,
      handoffState: trackerHandoffState,
      activeStates: asStringArray(tracker.active_states) ?? defaultActiveStates,
      terminalStates: asStringArray(tracker.terminal_states) ?? defaultTerminalStates,
    },
    polling: {
      intervalMs: asPositiveInt(polling.interval_ms, 30_000),
    },
    workspace: {
      root: resolveWorkspaceRoot(asString(workspace.root)),
    },
    hooks: {
      afterCreate: asString(hooks.after_create) || undefined,
      beforeRun: asString(hooks.before_run) || undefined,
      afterRun: asString(hooks.after_run) || undefined,
      beforeRemove: asString(hooks.before_remove) || undefined,
      timeoutMs: asPositiveInt(hooks.timeout_ms, 60_000),
    },
    agent: {
      maxConcurrentAgents: asPositiveInt(agent.max_concurrent_agents, 10),
      maxRetryBackoffMs: asPositiveInt(agent.max_retry_backoff_ms, 300_000),
      maxTurns: asPositiveInt(agent.max_turns, 12),
      maxInputTokensPerAttempt: asPositiveInt(agent.max_input_tokens_per_attempt, 150_000),
      maxIssueInputTokens: asPositiveInt(agent.max_issue_input_tokens, 300_000),
      maxContinuationRunsPerIssue: asPositiveInt(agent.max_continuation_runs_per_issue, 2),
      continuationRetryDelayMs: asPositiveInt(agent.continuation_retry_delay_ms, 30_000),
      maxConcurrentAgentsByState: normalizeStateLimits(agent.max_concurrent_agents_by_state),
    },
    codex: {
      command: asString(codex.command)?.trim() || "codex app-server",
      clientName: resolveConfigString(codex.client_name) || process.env.SYMPHONY_CLIENT_NAME || "symphony",
      clientVersion:
        resolveConfigString(codex.client_version) ||
        process.env.SYMPHONY_CLIENT_VERSION ||
        process.env.npm_package_version ||
        "unknown",
      clientCapabilities: asObject(codex.client_capabilities),
      approvalPolicy: codex.approval_policy,
      threadSandbox: codex.thread_sandbox,
      turnSandboxPolicy: codex.turn_sandbox_policy,
      turnTimeoutMs: asPositiveInt(codex.turn_timeout_ms, 3_600_000),
      readTimeoutMs: asPositiveInt(codex.read_timeout_ms, 5_000),
      stallTimeoutMs: asInt(codex.stall_timeout_ms, 300_000),
    },
  };
}

function resolveWorkspaceRoot(value: string | null): string {
  if (!value) {
    return join(tmpdir(), "symphony_workspaces");
  }

  return expandPathLike(value);
}

function expandPathLike(rawValue: string): string {
  let value = rawValue;

  if (value.startsWith("~")) {
    value = join(homedir(), value.slice(1));
  }

  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_match, name: string) => {
    return process.env[name] ?? "";
  });

  return value;
}

function resolveEnvReference(value: string | null): string {
  if (!value) {
    return "";
  }

  if (value.startsWith("$")) {
    return process.env[value.slice(1)] ?? "";
  }

  return value;
}

function resolveConfigString(value: unknown): string {
  return resolveEnvReference(asString(value));
}

function normalizeStateLimits(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, number> = {};
  for (const [state, rawLimit] of Object.entries(value)) {
    const limit = asPositiveInt(rawLimit, 0);
    if (limit > 0) {
      out[state.toLowerCase()] = limit;
    }
  }

  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const list = value.filter((entry): entry is string => typeof entry === "string");
  return list.length > 0 ? list : null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = asInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}
