import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  appendContextEvent,
  buildContextEventSemanticEnvelopeHash,
  isContextEventWriteQuotaExceeded,
  selectContextEventAppendQuotaDecision,
} from "./contextEvents";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("context event append safeguards", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts quota events by abuse partition and receivedAt window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const queryLog: Array<{
      field: string;
      operator: "eq" | "gte";
      value: unknown;
    }> = [];
    const matchingRecentEvents = Array.from({ length: 119 }, (_, index) => ({
      _id: `recent-${index}`,
      abusePartitionKey: "store_1:anonymous",
      idempotencyKey: `recent-${index}`,
      receivedAt: 999_000 - index,
      status: "recorded",
      storeId: "store_1",
      surface: "storefront",
    }));
    const contextEvent = [
      ...matchingRecentEvents,
      {
        _id: "old-event",
        abusePartitionKey: "store_1:anonymous",
        idempotencyKey: "old-event",
        receivedAt: 900_000,
        status: "recorded",
        storeId: "store_1",
        surface: "storefront",
      },
      {
        _id: "other-partition",
        abusePartitionKey: "store_1:other",
        idempotencyKey: "other-partition",
        receivedAt: 999_000,
        status: "recorded",
        storeId: "store_1",
        surface: "storefront",
      },
    ];
    const ctx = buildContextEventCtx(contextEvent, queryLog);
    const append = getHandler(appendContextEvent);
    const args = {
      abusePartitionKey: "store_1:anonymous",
      eventId: "storefront.route_viewed",
      idempotencyKey: "route:session:/shop",
      occurredAt: 999_500,
      payload: { route: "/shop" },
      schemaVersion: 1,
      storeId: "store_1",
      surface: "storefront",
      visibilityMode: "store_admin",
      retentionClass: "standard",
    };

    await expect(append(ctx, args)).resolves.toMatchObject({
      kind: "recorded",
    });
    expect(queryLog).toEqual(
      expect.arrayContaining([
        {
          field: "abusePartitionKey",
          operator: "eq",
          value: "store_1:anonymous",
        },
        { field: "receivedAt", operator: "gte", value: 940_000 },
      ]),
    );

    const quotaCtx = buildContextEventCtx(
      [
        ...matchingRecentEvents,
        {
          _id: "recent-limit",
          abusePartitionKey: "store_1:anonymous",
          idempotencyKey: "recent-limit",
          receivedAt: 999_750,
          status: "recorded",
          storeId: "store_1",
          surface: "storefront",
        },
      ],
      [],
    );

    await expect(append(quotaCtx, args)).resolves.toMatchObject({
      kind: "rejected",
      message: "Context event write quota exceeded.",
    });
    expect(quotaCtx.db.insert).not.toHaveBeenCalled();
  });

  it("uses a targeted abuse-partition quota index instead of filtering recorded events", () => {
    const root = process.cwd();
    const schemaSource = readFileSync(
      join(root, "convex", "schema.ts"),
      "utf8",
    );
    const appendSource = readFileSync(
      join(root, "convex", "contextTracking", "contextEvents.ts"),
      "utf8",
    );

    expect(schemaSource).toContain(
      '.index("by_storeId_surface_status_abusePartitionKey_receivedAt", [',
    );
    expect(appendSource).toContain("withIndex");
    expect(appendSource).toContain(
      '"by_storeId_surface_status_abusePartitionKey_receivedAt"',
    );
    expect(appendSource).not.toContain(".filter((q)");
  });

  it("rejects writes once the abuse partition reaches the window quota", () => {
    expect(isContextEventWriteQuotaExceeded(119)).toBe(false);
    expect(isContextEventWriteQuotaExceeded(120)).toBe(true);
    expect(isContextEventWriteQuotaExceeded(121)).toBe(true);
  });

  it("selects append quota behavior for partitioned and unpartitioned writes", () => {
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: undefined,
        recentEventCount: 10_000,
      }),
    ).toBe("skip_quota_check");
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: "store_1:anonymous",
        recentEventCount: 119,
      }),
    ).toBe("allow_write");
    expect(
      selectContextEventAppendQuotaDecision({
        abusePartitionKey: "store_1:anonymous",
        recentEventCount: 120,
      }),
    ).toBe("reject_quota_exceeded");
  });

  it("keeps retry duplicate hashes stable when only occurredAt changes", () => {
    const base = {
      storeId: "store_1",
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      idempotencyKey: "route:session:/shop",
      payload: { route: "/shop" },
    };

    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        occurredAt: 1_700_000_000_000,
      }),
    ).toBe(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        occurredAt: 1_700_000_100_000,
      }),
    );
  });

  it("keeps retry duplicate hashes stable when environment metadata changes", () => {
    const base = {
      storeId: "store_1",
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      idempotencyKey: "route:session:/shop",
      occurredAt: 1_700_000_000_000,
      payload: { route: "/shop" },
    };

    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "mobile" },
      }),
    ).toBe(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "desktop" },
      }),
    );
    expect(
      buildContextEventSemanticEnvelopeHash({
        ...base,
        environment: { deviceClass: "mobile" },
      }),
    ).toBe(buildContextEventSemanticEnvelopeHash(base));
  });
});

function buildContextEventCtx(
  contextEvent: Array<Record<string, unknown>>,
  queryLog: Array<{
    field: string;
    operator: "eq" | "gte";
    value: unknown;
  }>,
) {
  return {
    db: {
      insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${contextEvent.length + 1}`;
        contextEvent.push({ _id: id, ...value });
        return id;
      }),
      query: vi.fn((table: string) =>
        buildContextEventQuery(
          table === "contextEvent" ? contextEvent : [],
          queryLog,
        ),
      ),
    },
  };
}

function buildContextEventQuery(
  rows: Array<Record<string, unknown>>,
  queryLog: Array<{
    field: string;
    operator: "eq" | "gte";
    value: unknown;
  }>,
) {
  let currentRows = rows;
  const chain = {
    first: vi.fn(async () => currentRows[0] ?? null),
    take: vi.fn(async (count: number) => currentRows.slice(0, count)),
    withIndex: vi.fn(
      (
        _indexName: string,
        build: (q: {
          eq: (field: string, value: unknown) => unknown;
          gte: (field: string, value: number) => unknown;
        }) => unknown,
      ) => {
        const q = {
          eq: (field: string, value: unknown) => {
            queryLog.push({ field, operator: "eq", value });
            currentRows = currentRows.filter((row) => row[field] === value);
            return q;
          },
          gte: (field: string, value: number) => {
            queryLog.push({ field, operator: "gte", value });
            currentRows = currentRows.filter(
              (row) => Number(row[field] ?? Number.NEGATIVE_INFINITY) >= value,
            );
            return q;
          },
        };
        build(q);
        return chain;
      },
    ),
  };
  return chain;
}
