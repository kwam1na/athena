import type { PosLocalStoreSnapshot } from "./posLocalStoreSnapshot";
import { validatePosLocalStoreSnapshotShape } from "./posLocalStoreSnapshot";

type PosLocalStoreActivationOutcome =
  { status: "activated" } | { status: "not_activated" } | { status: "unknown" };

type TestOnlyMigrationDependencies = {
  activate(): Promise<PosLocalStoreActivationOutcome>;
  assessCapacity(): Promise<{
    status: "sufficient" | "insufficient" | "unknown";
  }>;
  cleanIncompleteTarget(): Promise<void>;
  exportSource(): Promise<PosLocalStoreSnapshot>;
  importTarget(snapshot: PosLocalStoreSnapshot): Promise<void>;
  verifyIntegrity(snapshot: PosLocalStoreSnapshot): Promise<boolean>;
  verifySemantics(): Promise<boolean>;
};

export type TestOnlyPosLocalStoreMigrationOutcome =
  | { status: "activated" }
  | { status: "capacity_refused"; reason: "insufficient" | "unknown" }
  | {
      status: "verification_failed";
      reason: "integrity" | "semantics" | "snapshot_shape";
    }
  | { status: "failed"; phase: "export" | "import" }
  | {
      status: "activation_unconfirmed";
      targetDisposition: "cleaned" | "retained";
    };

/**
 * Reference-fixture coordinator only. Intentionally not exported through the
 * application runtime and therefore cannot activate an alternate production engine.
 */
export function createTestOnlyPosLocalStoreMigrationCoordinator(
  dependencies: TestOnlyMigrationDependencies,
) {
  return {
    async migrate(): Promise<TestOnlyPosLocalStoreMigrationOutcome> {
      const capacity = await dependencies.assessCapacity();
      if (capacity.status !== "sufficient") {
        return { status: "capacity_refused", reason: capacity.status };
      }

      let snapshot: PosLocalStoreSnapshot;
      try {
        snapshot = await dependencies.exportSource();
      } catch {
        return { status: "failed", phase: "export" };
      }
      if (!validatePosLocalStoreSnapshotShape(snapshot).valid) {
        return { status: "verification_failed", reason: "snapshot_shape" };
      }
      try {
        await dependencies.importTarget(snapshot);
      } catch {
        await dependencies.cleanIncompleteTarget();
        return { status: "failed", phase: "import" };
      }
      try {
        if (!(await dependencies.verifyIntegrity(snapshot))) {
          await dependencies.cleanIncompleteTarget();
          return { status: "verification_failed", reason: "integrity" };
        }
        if (!(await dependencies.verifySemantics())) {
          await dependencies.cleanIncompleteTarget();
          return { status: "verification_failed", reason: "semantics" };
        }
      } catch {
        await dependencies.cleanIncompleteTarget();
        return { status: "verification_failed", reason: "semantics" };
      }
      let activation: PosLocalStoreActivationOutcome;
      try {
        activation = await dependencies.activate();
      } catch {
        return {
          status: "activation_unconfirmed",
          targetDisposition: "retained",
        };
      }
      if (activation.status === "not_activated") {
        await dependencies.cleanIncompleteTarget();
        return {
          status: "activation_unconfirmed",
          targetDisposition: "cleaned",
        };
      }
      if (activation.status === "unknown") {
        return {
          status: "activation_unconfirmed",
          targetDisposition: "retained",
        };
      }
      return { status: "activated" };
    },
  };
}
