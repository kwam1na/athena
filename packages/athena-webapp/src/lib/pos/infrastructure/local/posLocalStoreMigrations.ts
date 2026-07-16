export type PosLocalLogicalMigrationStep = Readonly<{
  from: number;
  id: string;
  to: number;
}>;

export const POS_LOCAL_OFFLINE_AUTHORITY_RECEIPT_MIGRATION = Object.freeze({
  from: 1,
  id: "v2-offline-authority-receipt",
  to: 2,
}) satisfies PosLocalLogicalMigrationStep;

export interface PosLocalLogicalMigrationPort {
  readLogicalRecordVersion(): Promise<number>;
  /** The engine applies the transformation and version marker as one native commit. */
  applyLogicalMigration(
    step: PosLocalLogicalMigrationStep,
  ): Promise<{ status: "applied" | "already_applied" | "failed" }>;
}

export type PosLocalMigrationOutcome =
  | { status: "current"; version: number }
  | { status: "migrated"; from: number; to: number; steps: string[] }
  | {
      status: "incompatible_future_version";
      current: number;
      supported: number;
    }
  | { status: "migration_path_missing"; at: number; target: number }
  | { status: "failed"; at: number; failedStep: string };

export async function runPosLocalStoreMigrations(
  port: PosLocalLogicalMigrationPort,
  migrations: readonly PosLocalLogicalMigrationStep[],
  targetVersion: number,
): Promise<PosLocalMigrationOutcome> {
  const initial = await port.readLogicalRecordVersion();
  if (initial > targetVersion) {
    return {
      status: "incompatible_future_version",
      current: initial,
      supported: targetVersion,
    };
  }
  if (initial === targetVersion) return { status: "current", version: initial };

  const byVersion = new Map(
    migrations.map((migration) => [migration.from, migration]),
  );
  const applied: string[] = [];
  let current = initial;
  while (current < targetVersion) {
    const step = byVersion.get(current);
    if (!step || step.to <= current || step.to > targetVersion) {
      return {
        status: "migration_path_missing",
        at: current,
        target: targetVersion,
      };
    }
    const outcome = await port.applyLogicalMigration(step);
    if (outcome.status === "failed") {
      return { status: "failed", at: current, failedStep: step.id };
    }
    applied.push(step.id);
    current = step.to;
  }
  return { status: "migrated", from: initial, to: current, steps: applied };
}
