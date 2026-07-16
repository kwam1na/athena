import { describe, expect, it, vi } from "vitest";

import {
  POS_LOCAL_OFFLINE_AUTHORITY_RECEIPT_MIGRATION,
  runPosLocalStoreMigrations,
} from "./posLocalStoreMigrations";

describe("runPosLocalStoreMigrations", () => {
  it("declares a v2 receipt migration without manufacturing authority", () => {
    expect(POS_LOCAL_OFFLINE_AUTHORITY_RECEIPT_MIGRATION).toEqual({
      from: 1,
      id: "v2-offline-authority-receipt",
      to: 2,
    });
    expect(POS_LOCAL_OFFLINE_AUTHORITY_RECEIPT_MIGRATION).not.toHaveProperty(
      "offlineAuthorityReceipt",
    );
  });
  it("runs ordered migrations atomically and exactly once", async () => {
    const applied: string[] = [];
    let version = 1;
    const port = {
      readLogicalRecordVersion: vi.fn(async () => version),
      applyLogicalMigration: vi.fn(
        async (step: { from: number; to: number; id: string }) => {
          applied.push(step.id);
          version = step.to;
          return { status: "applied" as const };
        },
      ),
    };
    const steps = [
      { from: 1, id: "one-to-two", to: 2 },
      { from: 2, id: "two-to-three", to: 3 },
    ];

    await expect(runPosLocalStoreMigrations(port, steps, 3)).resolves.toEqual({
      from: 1,
      status: "migrated",
      steps: ["one-to-two", "two-to-three"],
      to: 3,
    });
    await expect(runPosLocalStoreMigrations(port, steps, 3)).resolves.toEqual({
      status: "current",
      version: 3,
    });
    expect(applied).toEqual(["one-to-two", "two-to-three"]);
  });

  it("refuses future and incomplete version paths without mutation", async () => {
    const applyLogicalMigration = vi.fn();
    await expect(
      runPosLocalStoreMigrations(
        {
          readLogicalRecordVersion: async () => 4,
          applyLogicalMigration,
        },
        [],
        3,
      ),
    ).resolves.toEqual({
      current: 4,
      status: "incompatible_future_version",
      supported: 3,
    });
    await expect(
      runPosLocalStoreMigrations(
        {
          readLogicalRecordVersion: async () => 1,
          applyLogicalMigration,
        },
        [],
        3,
      ),
    ).resolves.toEqual({
      at: 1,
      status: "migration_path_missing",
      target: 3,
    });
    expect(applyLogicalMigration).not.toHaveBeenCalled();
  });

  it("stops at the last committed version when a step fails", async () => {
    let version = 1;
    await expect(
      runPosLocalStoreMigrations(
        {
          readLogicalRecordVersion: async () => version,
          applyLogicalMigration: async (step) => {
            if (step.to === 3) return { status: "failed" as const };
            version = step.to;
            return { status: "applied" as const };
          },
        },
        [
          { from: 1, id: "one-to-two", to: 2 },
          { from: 2, id: "two-to-three", to: 3 },
        ],
        3,
      ),
    ).resolves.toEqual({
      at: 2,
      failedStep: "two-to-three",
      status: "failed",
    });
  });
});
