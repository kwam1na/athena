import { buildRunExport } from "../.agent-skills/current/runtime/cli-api.mjs";
import type { RunEvent } from "../.agent-skills/current/runtime/kernel.mjs";

export function productRunFixture(options: { outcome?: "ok" | "policy"; treeSha?: string; runId?: string } = {}) {
  const runId = options.runId ?? "run-1234567890abcdef";
  const events: RunEvent[] = [
    { version: "run-event/1", seq: 1, runId, at: "2026-09-07T12:00:00Z", repo: { commonDir: "/repo/.git" }, actor: { role: "executor" }, attestation: "self", kind: "run.started", payload: { host: "codex", workflow: { releaseId: "product", profile: "linear" } } },
    { version: "run-event/1", seq: 2, runId, at: "2026-09-07T12:00:01Z", repo: { commonDir: "/repo/.git" }, actor: { role: "cli" }, attestation: "self", kind: "command.completed", payload: { command: "gate", outcome: options.outcome ?? "ok", durationMs: 1000 } },
  ];
  return buildRunExport({ runId, events });
}
