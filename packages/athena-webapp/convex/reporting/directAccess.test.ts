import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as reportingAccess from "./access";
import { preflightReportingRunAccessWithCtx } from "./directAccess";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
vi.mock("./access", () => ({ requireReportingStoreAccess: vi.fn() }));

function context(run: Record<string, unknown> | null) {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    ctx: {
      db: {
        get: vi.fn(async () => run),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}-${inserted.length}`;
        }),
      },
    },
    inserted,
  };
}

const args = {
  expectedRunType: "export" as const,
  operation: "export_status" as const,
  runId: "run-1" as Id<"reportingRun">,
  storeId: "store-1" as Id<"store">,
};

describe("reporting direct-run access preflight", () => {
  beforeEach(() => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({ _id: "user-1" } as never);
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockResolvedValue(
      {} as never,
    );
  });

  it("records a sanitized foreign-run probe without copying the run id", async () => {
    const harness = context({ runType: "export", storeId: "store-2" });
    await expect(
      preflightReportingRunAccessWithCtx(harness.ctx as never, args),
    ).resolves.toEqual({ allowed: false });
    expect(harness.inserted[0]).toMatchObject({
      table: "reportingIntegrityAttempt",
      value: {
        actorRef: "user-1",
        outcome: "denied",
        safeReason: "reporting_run_scope_mismatch",
        storeId: "store-1",
      },
    });
    expect(JSON.stringify(harness.inserted)).not.toContain("run-1");
  });

  it("records an indistinguishable store authorization denial", async () => {
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockRejectedValue(
      new Error("Reports access unavailable."),
    );
    const harness = context(null);
    await expect(
      preflightReportingRunAccessWithCtx(harness.ctx as never, args),
    ).resolves.toEqual({ allowed: false });
    expect(harness.inserted[0]).toMatchObject({
      table: "reportingIntegrityAttempt",
      value: {
        outcome: "denied",
        requestedStoreRef: "store-1",
        safeReason: "reporting_store_access_denied",
      },
    });
  });
});
