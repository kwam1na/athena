import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import * as reportingAccess from "./access";
import {
  encodeSkuEvidencePageCursor,
  preflightListSkuEvidenceWithCtx,
} from "./evidence";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));
vi.mock("./access", () => ({
  requireReportingStoreAccess: vi.fn(),
}));

function context(skuStoreId: string | null) {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    ctx: {
      db: {
        get: vi.fn(async () =>
          skuStoreId
            ? {
                _id: "sku-1" as Id<"productSku">,
                storeId: skuStoreId as Id<"store">,
              }
            : null,
        ),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}-${inserted.length}`;
        }),
      },
    },
    inserted,
  };
}

const baseArgs = {
  paginationOpts: { cursor: null, numItems: 25 },
  productSkuId: "sku-1" as Id<"productSku">,
  storeId: "store-1" as Id<"store">,
};

describe("SKU evidence access preflight", () => {
  beforeEach(() => {
    vi.mocked(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).mockResolvedValue({ _id: "user-1" } as never);
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockResolvedValue({
      athenaUser: { _id: "user-1" },
    } as never);
  });

  it("commits sanitized evidence for a foreign-store probe", async () => {
    vi.mocked(reportingAccess.requireReportingStoreAccess).mockRejectedValue(
      new Error("Reports access unavailable."),
    );
    const harness = context("store-2");

    await expect(
      preflightListSkuEvidenceWithCtx(harness.ctx as never, baseArgs),
    ).resolves.toEqual({ allowed: false });
    expect(harness.inserted).toContainEqual({
      table: "reportingIntegrityAttempt",
      value: expect.objectContaining({
        actorRef: "user-1",
        outcome: "denied",
        requestedStoreRef: "store-1",
        safeReason: "reporting_store_access_denied",
      }),
    });
    expect(JSON.stringify(harness.inserted)).not.toContain("sku-1");
  });

  it("commits sanitized evidence for a foreign-SKU probe", async () => {
    const harness = context("store-2");

    await expect(
      preflightListSkuEvidenceWithCtx(harness.ctx as never, baseArgs),
    ).resolves.toEqual({ allowed: false });
    expect(harness.inserted[0]).toMatchObject({
      table: "reportingIntegrityAttempt",
      value: {
        outcome: "denied",
        safeReason: "sku_evidence_scope_mismatch",
        storeId: "store-1",
      },
    });
    expect(JSON.stringify(harness.inserted)).not.toContain("sku-1");
  });

  it("commits sanitized evidence for a cursor bound to another store", async () => {
    const harness = context("store-1");
    const cursor = encodeSkuEvidencePageCursor({
      databaseCursor: "database-cursor",
      factVersion: 1,
      filterKey: "sku:sku-1|start:all|end:all",
      metricVersion: 1,
      storeId: "store-2",
    });

    await expect(
      preflightListSkuEvidenceWithCtx(harness.ctx as never, {
        ...baseArgs,
        paginationOpts: { cursor, numItems: 25 },
      }),
    ).resolves.toEqual({ allowed: false });
    expect(harness.inserted[0]).toMatchObject({
      table: "reportingIntegrityAttempt",
      value: {
        outcome: "denied",
        safeReason: "sku_evidence_cursor_scope_mismatch",
        storeId: "store-1",
      },
    });
    expect(JSON.stringify(harness.inserted)).not.toContain("database-cursor");
  });
});
