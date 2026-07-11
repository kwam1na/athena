export type PosLocalStoreClearInspection =
  | { status: "failed" }
  | {
      status: "complete";
      activePresenceCount: number;
      activeWorkflowCount: number;
      authorityRecordCount: number;
      eventCount: number;
      migrationInProgress: boolean;
      retainedSource: boolean;
      unresolvedActivityCount: number;
    };

export type PosLocalStoreClearAssessment =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "active_presence"
        | "active_workflow"
        | "authority_present"
        | "events_present"
        | "inspection_failed"
        | "migration_in_progress"
        | "retained_source"
        | "unresolved_activity";
    };

export function assessPosLocalStoreClear(
  inspection: PosLocalStoreClearInspection,
): PosLocalStoreClearAssessment {
  if (
    inspection.status !== "complete" ||
    !hasValidClearInspectionCounts(inspection)
  ) {
    return { allowed: false, reason: "inspection_failed" };
  }
  if (inspection.eventCount > 0)
    return { allowed: false, reason: "events_present" };
  if (inspection.authorityRecordCount > 0)
    return { allowed: false, reason: "authority_present" };
  if (inspection.activePresenceCount > 0)
    return { allowed: false, reason: "active_presence" };
  if (inspection.activeWorkflowCount > 0)
    return { allowed: false, reason: "active_workflow" };
  if (inspection.unresolvedActivityCount > 0)
    return { allowed: false, reason: "unresolved_activity" };
  if (inspection.migrationInProgress)
    return { allowed: false, reason: "migration_in_progress" };
  if (inspection.retainedSource)
    return { allowed: false, reason: "retained_source" };
  return { allowed: true };
}

function hasValidClearInspectionCounts(
  inspection: Extract<PosLocalStoreClearInspection, { status: "complete" }>,
) {
  return (
    [
      inspection.activePresenceCount,
      inspection.activeWorkflowCount,
      inspection.authorityRecordCount,
      inspection.eventCount,
      inspection.unresolvedActivityCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
    typeof inspection.migrationInProgress === "boolean" &&
    typeof inspection.retainedSource === "boolean"
  );
}

export interface PosLocalExclusiveMaintenanceSession {
  run<T>(operation: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PosLocalStoreMaintenancePort {
  beginExclusiveMaintenance(): Promise<
    PosLocalExclusiveMaintenanceSession | undefined
  >;
}

export async function runExclusivePosLocalStoreMaintenance<T>(
  port: PosLocalStoreMaintenancePort,
  operation: () => Promise<T>,
): Promise<{ status: "busy" } | { status: "completed"; value: T }> {
  const session = await port.beginExclusiveMaintenance();
  if (!session) return { status: "busy" };
  try {
    return { status: "completed", value: await session.run(operation) };
  } finally {
    await session.close();
  }
}
