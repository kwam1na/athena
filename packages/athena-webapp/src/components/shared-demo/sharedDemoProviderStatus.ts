export type SharedDemoProvidedBootstrapStatus =
  | "idle"
  | "provisioning"
  | "projecting"
  | "ready"
  | "failed";

export function resolveSharedDemoProvidedBootstrapStatus({
  bootstrapStatus,
  gatePosUntilReady,
  hasAppliedRestoreEpoch,
  hasContext,
  restoreStatus,
}: {
  bootstrapStatus: SharedDemoProvidedBootstrapStatus;
  gatePosUntilReady: boolean;
  hasAppliedRestoreEpoch: boolean;
  hasContext: boolean;
  restoreStatus?: "failed" | "ready" | "restoring";
}): SharedDemoProvidedBootstrapStatus {
  if (!gatePosUntilReady || !hasContext) return "ready";
  if (restoreStatus === "failed") return "failed";
  if (restoreStatus !== "ready" || !hasAppliedRestoreEpoch) {
    return "provisioning";
  }
  return bootstrapStatus;
}
