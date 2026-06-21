export type IntelligenceRunStatus =
  | "queued"
  | "context_captured"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export type IntelligenceArtifactStatus =
  | "ready"
  | "stale"
  | "superseded"
  | "dismissed"
  | "failed";

const RUN_TRANSITIONS: Record<IntelligenceRunStatus, Set<IntelligenceRunStatus>> = {
  queued: new Set(["context_captured", "running", "failed", "canceled"]),
  context_captured: new Set(["running", "failed", "canceled"]),
  running: new Set(["completed", "failed", "canceled"]),
  completed: new Set([]),
  failed: new Set([]),
  canceled: new Set([]),
};

const ARTIFACT_TRANSITIONS: Record<
  IntelligenceArtifactStatus,
  Set<IntelligenceArtifactStatus>
> = {
  ready: new Set(["stale", "superseded", "dismissed"]),
  stale: new Set(["superseded", "dismissed"]),
  superseded: new Set([]),
  dismissed: new Set([]),
  failed: new Set([]),
};

export function canTransitionRun(
  from: IntelligenceRunStatus,
  to: IntelligenceRunStatus,
) {
  return RUN_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertRunTransition(
  from: IntelligenceRunStatus,
  to: IntelligenceRunStatus,
) {
  if (!canTransitionRun(from, to)) {
    throw new Error(`Invalid intelligence run transition: ${from} -> ${to}`);
  }
}

export function canTransitionArtifact(
  from: IntelligenceArtifactStatus,
  to: IntelligenceArtifactStatus,
) {
  return ARTIFACT_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertArtifactTransition(
  from: IntelligenceArtifactStatus,
  to: IntelligenceArtifactStatus,
) {
  if (!canTransitionArtifact(from, to)) {
    throw new Error(`Invalid intelligence artifact transition: ${from} -> ${to}`);
  }
}
