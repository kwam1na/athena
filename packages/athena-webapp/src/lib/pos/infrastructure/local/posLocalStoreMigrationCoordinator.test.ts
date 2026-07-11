import { describe, expect, it, vi } from "vitest";

import { createTestOnlyPosLocalStoreMigrationCoordinator } from "./posLocalStoreMigrationCoordinator";
import { POS_LOCAL_STORE_V9_LOGICAL_FIXTURE } from "./__fixtures__/posLocalStoreV9";
import { fixtureIntegrity } from "./__fixtures__/posLocalStoreV9";
import type { PosLocalStoreSnapshot } from "./posLocalStoreSnapshot";

describe("test-only POS local store migration coordinator", () => {
  it("activates only after capacity, import, integrity, and semantics pass", async () => {
    const source = createLogicalFixtureEngine(
      POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
    );
    const target = createLogicalFixtureEngine();
    const activate = vi.fn(async () => ({ status: "activated" as const }));
    const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
      activate,
      assessCapacity: async () => ({ status: "sufficient" }),
      cleanIncompleteTarget: target.clear,
      exportSource: source.exportSnapshot,
      importTarget: target.importSnapshot,
      verifyIntegrity: target.verifyIntegrity,
      verifySemantics: async () =>
        JSON.stringify(source.project()) === JSON.stringify(target.project()),
    });

    await expect(coordinator.migrate()).resolves.toEqual({
      status: "activated",
    });
    expect(activate).toHaveBeenCalledOnce();
    await expect(target.exportSnapshot()).resolves.toEqual(
      POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
    );
  });

  it.each(["unknown", "insufficient"] as const)(
    "refuses %s capacity before import",
    async (status) => {
      const importTarget = vi.fn();
      const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
        activate: vi.fn(),
        assessCapacity: async () => ({ status }),
        cleanIncompleteTarget: vi.fn(),
        exportSource: vi.fn(),
        importTarget,
        verifyIntegrity: vi.fn(),
        verifySemantics: vi.fn(),
      });

      await expect(coordinator.migrate()).resolves.toEqual({
        status: "capacity_refused",
        reason: status,
      });
      expect(importTarget).not.toHaveBeenCalled();
    },
  );

  it("refuses a malformed snapshot before import or activation", async () => {
    const importTarget = vi.fn();
    const activate = vi.fn();
    const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
      activate,
      assessCapacity: async () => ({ status: "sufficient" }),
      cleanIncompleteTarget: vi.fn(),
      exportSource: async () => ({
        envelopeVersion: 1,
        manifest: { integrity: "invalid", sections: [] },
        sections: {},
      }),
      importTarget,
      verifyIntegrity: vi.fn(),
      verifySemantics: vi.fn(),
    });

    await expect(coordinator.migrate()).resolves.toEqual({
      status: "verification_failed",
      reason: "snapshot_shape",
    });
    expect(importTarget).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("cleans an incomplete target and preserves the source on verification failure", async () => {
    const cleanIncompleteTarget = vi.fn(async () => undefined);
    const activate = vi.fn();
    const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
      activate,
      assessCapacity: async () => ({ status: "sufficient" }),
      cleanIncompleteTarget,
      exportSource: async () => POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
      importTarget: async () => undefined,
      verifyIntegrity: async () => false,
      verifySemantics: async () => true,
    });

    await expect(coordinator.migrate()).resolves.toEqual({
      status: "verification_failed",
      reason: "integrity",
    });
    expect(cleanIncompleteTarget).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it.each([
    ["not_activated", "cleaned"],
    ["unknown", "retained"],
  ] as const)(
    "handles a %s activation outcome without risking selected data",
    async (status, targetDisposition) => {
      const cleanIncompleteTarget = vi.fn(async () => undefined);
      const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
        activate: async () => ({ status }),
        assessCapacity: async () => ({ status: "sufficient" }),
        cleanIncompleteTarget,
        exportSource: async () => POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
        importTarget: async () => undefined,
        verifyIntegrity: async () => true,
        verifySemantics: async () => true,
      });

      await expect(coordinator.migrate()).resolves.toEqual({
        status: "activation_unconfirmed",
        targetDisposition,
      });
      expect(cleanIncompleteTarget).toHaveBeenCalledTimes(
        status === "not_activated" ? 1 : 0,
      );
    },
  );

  it("retains the target when activation throws with unknown commit state", async () => {
    const cleanIncompleteTarget = vi.fn();
    const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
      activate: async () => {
        throw new Error("ambiguous activation failure");
      },
      assessCapacity: async () => ({ status: "sufficient" }),
      cleanIncompleteTarget,
      exportSource: async () => POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
      importTarget: async () => undefined,
      verifyIntegrity: async () => true,
      verifySemantics: async () => true,
    });

    await expect(coordinator.migrate()).resolves.toEqual({
      status: "activation_unconfirmed",
      targetDisposition: "retained",
    });
    expect(cleanIncompleteTarget).not.toHaveBeenCalled();
  });

  it("rejects tampered imported content before activation", async () => {
    const target = createLogicalFixtureEngine();
    const activate = vi.fn();
    const coordinator = createTestOnlyPosLocalStoreMigrationCoordinator({
      activate,
      assessCapacity: async () => ({ status: "sufficient" }),
      cleanIncompleteTarget: target.clear,
      exportSource: async () => POS_LOCAL_STORE_V9_LOGICAL_FIXTURE,
      importTarget: async (snapshot) => {
        const tampered = structuredClone(snapshot);
        (tampered.sections.events as unknown[]).pop();
        await target.importSnapshot(tampered);
      },
      verifyIntegrity: target.verifyIntegrity,
      verifySemantics: async () => true,
    });

    await expect(coordinator.migrate()).resolves.toEqual({
      status: "verification_failed",
      reason: "integrity",
    });
    expect(activate).not.toHaveBeenCalled();
  });
});

function createLogicalFixtureEngine(initial?: PosLocalStoreSnapshot) {
  let snapshot = initial ? structuredClone(initial) : null;
  return {
    clear: vi.fn(async () => {
      snapshot = null;
    }),
    exportSnapshot: vi.fn(async () => {
      if (!snapshot) throw new Error("snapshot missing");
      return structuredClone(snapshot);
    }),
    importSnapshot: vi.fn(async (next: PosLocalStoreSnapshot) => {
      snapshot = structuredClone(next);
    }),
    project() {
      const events = (snapshot?.sections.events ?? []) as Array<
        Record<string, unknown>
      >;
      const mappings = (snapshot?.sections.mappings ?? []) as Array<
        Record<string, unknown>
      >;
      return {
        eventOrder: events.map((event) => event.localEventId),
        expenseEventCount: events.filter(
          (event) => event.type === "expense.completed",
        ).length,
        mappingSubjects: mappings.map((mapping) => ({
          current: mapping.registerCandidateState,
          localId: mapping.localId,
          revision: mapping.mappingAuthorityRevision,
        })),
        registerEventCount: events.filter((event) =>
          String(event.type).startsWith("register."),
        ).length,
        saleEventCount: events.filter(
          (event) => event.type === "transaction.completed",
        ).length,
      };
    },
    verifyIntegrity: vi.fn(async (source: PosLocalStoreSnapshot) => {
      if (!snapshot) return false;
      return (
        snapshot.manifest.integrity === fixtureIntegrity(snapshot.sections) &&
        source.manifest.integrity === snapshot.manifest.integrity
      );
    }),
  };
}
