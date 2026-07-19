export type SharedDemoRestoreOverlayPhase =
  | "failed"
  | "hidden"
  | "preparing"
  | "restoring";

export function resolveSharedDemoRestoreOverlayPhase({
  bootstrapStatus,
  hasAppliedRestoreEpoch,
  restoreStatus,
}: {
  bootstrapStatus: "failed" | "idle" | "projecting" | "provisioning" | "ready";
  hasAppliedRestoreEpoch: boolean;
  restoreStatus: "failed" | "ready" | "restoring";
}): SharedDemoRestoreOverlayPhase {
  if (restoreStatus === "failed") return "failed";
  if (restoreStatus === "restoring") return "restoring";
  if (!hasAppliedRestoreEpoch) {
    return bootstrapStatus === "failed" ? "failed" : "preparing";
  }
  return "hidden";
}
