import { SymphonyError } from "./errors";
import type { EffectiveConfig } from "./types";

export function validateDispatchPreflight(config: EffectiveConfig): void {
  if (!config.tracker.kind) {
    throw new SymphonyError("unsupported_tracker_kind", "tracker.kind is required and must be supported (currently: linear)");
  }

  if (config.tracker.kind !== "linear") {
    throw new SymphonyError(
      "unsupported_tracker_kind",
      `unsupported tracker.kind: ${JSON.stringify(config.tracker.kind)} (supported: \"linear\")`,
    );
  }

  if (!config.tracker.apiKey) {
    throw new SymphonyError("missing_tracker_api_key", "tracker.api_key is missing after environment resolution");
  }

  if (!config.tracker.projectSlug) {
    throw new SymphonyError("missing_tracker_project_slug", "tracker.project_slug is required when tracker.kind is linear");
  }

  if (!config.codex.command.trim()) {
    throw new SymphonyError("missing_codex_command", "codex.command is required");
  }
}
