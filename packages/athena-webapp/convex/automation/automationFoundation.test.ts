import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  defineAutomationAction,
  registerAutomationActions,
} from "./actionRegistry";
import { evaluateAutomationActionWithCtx } from "./automationFoundation";
import {
  getOpeningAutoStartPolicyConfigWithCtx,
  recordAutomationRunWithCtx,
  upsertOpeningAutoStartPolicyConfigWithCtx,
} from "./runLedger";

type TableName = "automationPolicy" | "automationRun";
type Row = Record<string, unknown> & { _id: string };

function createDb(seed: Partial<Record<TableName, Row[]>> = {}) {
  const tables = new Map<TableName, Map<string, Row>>();
  const inserts: Array<{ table: TableName; value: Row }> = [];
  const patches: Array<{
    id: string;
    table: TableName;
    value: Record<string, unknown>;
  }> = [];

  const tableFor = (table: TableName) => {
    if (!tables.has(table)) {
      tables.set(table, new Map());
    }

    return tables.get(table)!;
  };

  Object.entries(seed).forEach(([tableName, rows]) => {
    const table = tableFor(tableName as TableName);
    rows?.forEach((row) => table.set(row._id, { ...row }));
  });

  const query = (table: TableName) => {
    const filters: Array<[string, unknown]> = [];
    const rows = () =>
      Array.from(tableFor(table).values()).filter((row) =>
        filters.every(([field, value]) => row[field] === value),
      );
    const chain = {
      collect: async () => rows(),
      first: async () => rows()[0] ?? null,
      take: async (limit: number) => rows().slice(0, limit),
      withIndex(
        _index: string,
        applyIndex: (builder: {
          eq: (field: string, value: unknown) => typeof builder;
        }) => unknown,
      ) {
        const builder = {
          eq(field: string, value: unknown) {
            filters.push([field, value]);
            return builder;
          },
        };

        applyIndex(builder);
        return chain;
      },
    };

    return chain;
  };

  const db = {
    async get(tableOrId: string, maybeId?: string) {
      if (maybeId !== undefined) {
        return tableFor(tableOrId as TableName).get(maybeId) ?? null;
      }

      for (const table of tables.values()) {
        const row = table.get(tableOrId);
        if (row) return row;
      }

      return null;
    },
    async insert(table: TableName, value: Record<string, unknown>) {
      const id = `${table}-${tableFor(table).size + 1}`;
      const row = { _id: id, ...value };
      tableFor(table).set(id, row);
      inserts.push({ table, value: row });
      return id;
    },
    async patch(
      tableOrId: TableName | string,
      idOrPatch: string | Record<string, unknown>,
      maybePatch?: Record<string, unknown>,
    ) {
      const explicitTable =
        typeof idOrPatch === "string" ? (tableOrId as TableName) : null;
      const id = typeof idOrPatch === "string" ? idOrPatch : tableOrId;
      const patch = typeof idOrPatch === "string" ? maybePatch : idOrPatch;
      const tableEntries = explicitTable
        ? [[explicitTable, tableFor(explicitTable)] as const]
        : [...tables.entries()];

      if (!patch) {
        throw new Error(`Missing patch for row ${id}`);
      }

      for (const [table, rows] of tableEntries) {
        const row = rows.get(id);

        if (row) {
          Object.assign(row, patch);
          patches.push({ id, table, value: patch });
          return;
        }
      }

      throw new Error(`Missing row ${id}`);
    },
    query,
  };

  return { db, inserts, patches, tables };
}

const action = defineAutomationAction({
  action: "opening.auto_start",
  allowedOutcomes: [
    "disabled",
    "dry_run",
    "skipped",
    "eligible",
    "applied",
    "failed",
  ],
  domain: "test_domain",
  mutationBoundary: "test-only mutation",
  requiresSourceSubjects: true,
  triggerType: "scheduled",
});

const eligibleDecision = {
  outcome: "eligible" as const,
  decisionReason: "Clean snapshot.",
  snapshotCounts: {
    blockerCount: 0,
    reviewCount: 0,
  },
  sourceSubjects: [
    {
      id: "subject-1",
      label: "Subject",
      type: "test_subject",
    },
  ],
};

describe("automation foundation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers domain-neutral automation action definitions", () => {
    const registry = registerAutomationActions([action]);

    expect(registry.get("test_domain.opening.auto_start")).toEqual(action);
    expect(() => registerAutomationActions([action, action])).toThrow(
      "Automation action already registered",
    );
  });

  it("records automation runs with source subjects and snapshot counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 8, 9));
    const { db } = createDb();

    const run = await recordAutomationRunWithCtx(
      { db } as unknown as MutationCtx,
      {
        action: "opening.auto_start",
        domain: "daily_operations",
        idempotencyKey:
          "daily_operations:opening.auto_start:store-1:2026-06-08",
        mutationBoundary: "Opening Handoff lifecycle only",
        operatingDate: "2026-06-08",
        outcome: "dry_run",
        policyMode: "dry_run",
        policyVersion: "automation-foundation.v1",
        snapshotCounts: { blockerCount: 0 },
        sourceSubjects: [{ type: "daily_close", id: "close-1" }],
        storeId: "store-1" as Id<"store">,
        triggerType: "scheduled",
      },
    );

    expect(run).toMatchObject({
      action: "opening.auto_start",
      createdAt: Date.UTC(2026, 5, 8, 9),
      domain: "daily_operations",
      outcome: "dry_run",
      sourceSubjects: [{ type: "daily_close", id: "close-1" }],
    });
  });

  it("reads missing Opening auto-start policy config as disabled defaults", async () => {
    const { db } = createDb();

    const config = await getOpeningAutoStartPolicyConfigWithCtx(
      { db } as unknown as MutationCtx,
      {
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(config).toEqual({
      configured: false,
      mode: "disabled",
      openingBlockerHandling: "skip",
      openingLocalStartMinutes: 0,
      paused: false,
      policy: null,
    });
  });

  it("upserts Opening auto-start policy config with local start and blocker handling", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 5, 8, 9));
    const { db, inserts, patches } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "daily_operations",
          mode: "dry_run",
          openingBlockerHandling: "skip",
          openingLocalStartMinutes: 480,
          policyVersion: "daily-operations.v1",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });

    const updated = await upsertOpeningAutoStartPolicyConfigWithCtx(
      { db } as unknown as MutationCtx,
      {
        mode: "enabled",
        openingBlockerHandling: "manager_review",
        openingLocalStartMinutes: 510,
        operatingTimezoneOffsetMinutes: 0,
        organizationId: "org-1" as Id<"organization">,
        policyVersion: "daily-operations.v2",
        storeId: "store-1" as Id<"store">,
        updatedByUserId: "user-1" as Id<"athenaUser">,
      },
    );

    expect(updated).toMatchObject({
      _id: "policy-1",
      mode: "enabled",
      openingBlockerHandling: "manager_review",
      openingLocalStartMinutes: 510,
      operatingTimezoneOffsetMinutes: 0,
      organizationId: "org-1",
      policyVersion: "daily-operations.v2",
      updatedAt: Date.UTC(2026, 5, 8, 9),
      updatedByUserId: "user-1",
    });
    expect(inserts).toEqual([]);
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "policy-1",
        table: "automationPolicy",
        value: expect.objectContaining({
          openingBlockerHandling: "manager_review",
          openingLocalStartMinutes: 510,
        }),
      }),
    );
  });

  it("rejects invalid Opening local start minutes", async () => {
    const { db } = createDb();

    await expect(
      upsertOpeningAutoStartPolicyConfigWithCtx(
        { db } as unknown as MutationCtx,
        {
          mode: "enabled",
          openingBlockerHandling: "manager_review",
          openingLocalStartMinutes: 1_440,
          storeId: "store-1" as Id<"store">,
        },
      ),
    ).rejects.toThrow("Opening local start minutes must be within one local day.");
  });

  it("defaults store actions to disabled and does not call the handler", async () => {
    const { db, inserts } = createDb();
    const apply = vi.fn();

    const result = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        action,
        adapterDecision: eligibleDecision,
        apply,
        idempotencyKey:
          "test_domain:opening.auto_start:store-1:2026-06-08",
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      outcome: "disabled",
      policyMode: "disabled",
    });
    expect(apply).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
  });

  it("records dry-run decisions without applying the domain handler", async () => {
    const { db } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "dry_run",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });
    const apply = vi.fn();

    const result = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        action,
        adapterDecision: eligibleDecision,
        apply,
        idempotencyKey:
          "test_domain:opening.auto_start:store-1:2026-06-08",
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      outcome: "dry_run",
      policyMode: "dry_run",
      policyVersion: "policy.v2",
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies enabled eligible decisions once after transient decisions by idempotency key", async () => {
    const { db, inserts, patches } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "enabled",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });
    const apply = vi.fn().mockResolvedValue({
      eventIds: ["event-1" as Id<"operationalEvent">],
      outcome: "applied" as const,
    });
    const args = {
      action,
      adapterDecision: eligibleDecision,
      apply,
      idempotencyKey: "test_domain:opening.auto_start:store-1:2026-06-08",
      operatingDate: "2026-06-08",
      storeId: "store-1" as Id<"store">,
    };

    const skipped = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        ...args,
        adapterDecision: {
          ...eligibleDecision,
          decisionReason: "Snapshot still has review work.",
          outcome: "skipped",
        },
        apply,
      },
    );
    const first = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      args,
    );
    const second = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      args,
    );

    expect(skipped.run).toMatchObject({
      outcome: "skipped",
    });
    expect(first.action).toBe("applied");
    expect(first.run).toMatchObject({
      eventIds: ["event-1"],
      outcome: "applied",
    });
    expect(second.action).toBe("already_recorded");
    expect(second.run._id).toBe(first.run._id);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(inserts.filter((insert) => insert.table === "automationRun")).toHaveLength(2);
    expect(patches).toContainEqual(
      expect.objectContaining({
        table: "automationRun",
        value: expect.objectContaining({
          eventIds: ["event-1"],
          outcome: "applied",
        }),
      }),
    );
  });

  it("records invalid adapter input as a failed run without mutation", async () => {
    const { db } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "enabled",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });
    const apply = vi.fn();

    const result = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        action,
        adapterDecision: {
          ...eligibleDecision,
          sourceSubjects: [],
        },
        apply,
        idempotencyKey:
          "test_domain:opening.auto_start:store-1:2026-06-08",
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      error: {
        code: "missing_source_subjects",
      },
      outcome: "failed",
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("records invalid operating dates as failed runs without mutation", async () => {
    const { db } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "enabled",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });
    const apply = vi.fn();

    const result = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        action,
        adapterDecision: eligibleDecision,
        apply,
        idempotencyKey: "test_domain:opening.auto_start:store-1:not-a-date",
        operatingDate: "not-a-date",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      error: {
        code: "invalid_operating_date",
      },
      outcome: "failed",
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("fails closed when duplicate store action policies exist", async () => {
    const { db } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "enabled",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
        {
          _id: "policy-2",
          action: "opening.auto_start",
          createdAt: 2,
          domain: "test_domain",
          mode: "dry_run",
          policyVersion: "policy.v3",
          storeId: "store-1",
          updatedAt: 2,
        },
      ],
    });
    const apply = vi.fn();

    const result = await evaluateAutomationActionWithCtx(
      { db } as unknown as MutationCtx,
      {
        action,
        adapterDecision: eligibleDecision,
        apply,
        idempotencyKey:
          "test_domain:opening.auto_start:store-1:2026-06-08",
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(result.run).toMatchObject({
      error: {
        code: "duplicate_policy",
      },
      outcome: "failed",
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("propagates unexpected apply failures so domain writes roll back", async () => {
    const { db } = createDb({
      automationPolicy: [
        {
          _id: "policy-1",
          action: "opening.auto_start",
          createdAt: 1,
          domain: "test_domain",
          mode: "enabled",
          policyVersion: "policy.v2",
          storeId: "store-1",
          updatedAt: 1,
        },
      ],
    });

    await expect(
      evaluateAutomationActionWithCtx({ db } as unknown as MutationCtx, {
        action,
        adapterDecision: eligibleDecision,
        apply: async () => {
          throw new Error("audit event insert failed");
        },
        idempotencyKey:
          "test_domain:opening.auto_start:store-1:2026-06-08",
        operatingDate: "2026-06-08",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("audit event insert failed");
  });
});
