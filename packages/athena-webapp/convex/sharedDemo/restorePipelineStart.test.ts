import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";

const seams = vi.hoisted(() => ({
  begin: vi.fn(async () => ({ status: "started", generation: 1 })),
  purge: vi.fn(async () => ({ deleted: 0, hasMore: false })),
  baseline: vi.fn(async () => ({
    actualCounts: {},
    expectedCounts: {},
    restored: 0,
  })),
}));
vi.mock("./domainRestore", () => ({
  restoreMutableDemoStoreRowsWithCtx: seams.baseline,
}));
vi.mock("./openingBaseline", () => ({
  rollSharedDemoOpeningBaselineWithCtx: vi.fn(),
}));
vi.mock("./registerBaseline", () => ({
  rollSharedDemoSeededRegisterWithCtx: vi.fn(),
}));
vi.mock("../reports/pipelineMaintenance", () => ({
  purgePipelineBatchWithCtx: seams.purge,
}));
vi.mock("../reports/pipelineMigrationStart", () => ({
  beginPipelineMigrationWithCtx: seams.begin,
}));
import { applyRestoreLeaseWithCtx } from "./restore";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("demo restore shadow rebuild handoff", () => {
  it("starts automatic continuation after apply but never opts into activation or restarts a duplicate receipt", async () => {
    vi.stubEnv("REPORTS_SWEEP_STORE_ALLOWLIST", "demo-store");
    const state: Record<string, unknown> = {
      _id: "state",
      storeId: "demo-store",
      baselineVersion: SHARED_DEMO_BASELINE_VERSION,
      epoch: 7,
      idempotencyKey: "restore-7",
      status: "restoring",
      phase: "leased",
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: () => ({
            unique: async () =>
              table === "sharedDemoRestoreState" ? state : null,
            take: async () => [],
          }),
        }),
        patch: async (
          table: string,
          _id: string,
          value: Record<string, unknown>,
        ) => {
          if (table === "sharedDemoRestoreState") Object.assign(state, value);
        },
        insert: vi.fn(),
      },
    };
    const args = {
      storeId: "demo-store" as never,
      epoch: 7,
      idempotencyKey: "restore-7",
      source: "manual" as const,
      now: 123,
    };
    await applyRestoreLeaseWithCtx(ctx as never, args);
    expect(seams.begin).toHaveBeenCalledWith(
      ctx,
      {
        storeId: "demo-store",
        epoch: "demo-restore-7",
        dryRun: false,
        autoContinue: true,
      },
      123,
    );
    expect(seams.baseline.mock.invocationCallOrder[0]).toBeLessThan(
      seams.begin.mock.invocationCallOrder[0],
    );
    expect(state.phase).toBe("applied");
    await applyRestoreLeaseWithCtx(ctx as never, args);
    expect(seams.begin).toHaveBeenCalledTimes(1);
    expect(seams.purge).toHaveBeenCalledTimes(1);
  });
});
