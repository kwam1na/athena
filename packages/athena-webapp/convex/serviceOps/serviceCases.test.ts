import { beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { Id } from "../_generated/dataModel";
import {
  assertValidServiceCaseStatusTransition,
  buildServiceCase,
  buildServiceCaseLineItem,
  mapServiceCaseStatusToWorkItemStatus,
  recordServiceInventoryUsage,
  updateServiceCaseStatus,
} from "./serviceCases";

const reportingMocks = vi.hoisted(() => ({
  appendReportingIngressWithCtx: vi.fn(),
  applyInventoryEffectWithCtx: vi.fn(),
  recordServiceCaseTraceBestEffort: vi.fn(),
  resolveReportingOperatingPeriodWithCtx: vi.fn(),
}));

vi.mock("../reporting/inventory/effects", () => ({
  applyInventoryEffectWithCtx: reportingMocks.applyInventoryEffectWithCtx,
}));

vi.mock("../reporting/ingress", () => ({
  appendReportingIngressWithCtx: reportingMocks.appendReportingIngressWithCtx,
}));

vi.mock("../reporting/operatingPeriods", () => ({
  resolveReportingOperatingPeriodWithCtx:
    reportingMocks.resolveReportingOperatingPeriodWithCtx,
}));

vi.mock("./serviceCaseTracing", () => ({
  recordServiceCaseTraceBestEffort:
    reportingMocks.recordServiceCaseTraceBestEffort,
}));

beforeEach(() => {
  reportingMocks.appendReportingIngressWithCtx.mockReset();
  reportingMocks.applyInventoryEffectWithCtx.mockReset();
  reportingMocks.applyInventoryEffectWithCtx.mockResolvedValue({
    movement: { _id: "movement-1" },
  });
  reportingMocks.recordServiceCaseTraceBestEffort.mockReset();
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockReset();
  reportingMocks.resolveReportingOperatingPeriodWithCtx.mockResolvedValue({
    kind: "resolved",
    operatingDate: "2026-07-09",
    scheduleVersionId: "schedule-1",
  });
});

type IndexExpectation = {
  table: string;
  descriptor: string;
  fields: string[];
};

function getTableIndexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

function expectIndex({ table, descriptor, fields }: IndexExpectation) {
  expect(getTableIndexes(table)).toContainEqual({
    indexDescriptor: descriptor,
    fields,
  });
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function createInventoryUsageCtx(args?: {
  inventoryEffect?: Record<string, unknown>;
  inventoryMovement?: Record<string, unknown>;
  priorUsage?: Array<Record<string, unknown>>;
}) {
  const rows: Record<string, Map<string, Record<string, unknown>>> = {
    inventoryMovement: new Map(
      args?.inventoryMovement
        ? [["prior-movement", args.inventoryMovement]]
        : [],
    ),
    operationalEvent: new Map(),
    operationalWorkItem: new Map([
      ["work-1", { _id: "work-1", storeId: "store-1" }],
    ]),
    productSku: new Map([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 1,
          productId: "product-1",
          quantityAvailable: 1,
          storeId: "store-1",
        },
      ],
    ]),
    reportingInventoryEffect: new Map(
      args?.inventoryEffect
        ? [["prior-effect", args.inventoryEffect]]
        : [],
    ),
    serviceCase: new Map([
      [
        "case-1",
        {
          _id: "case-1",
          customerProfileId: "customer-1",
          operationalWorkItemId: "work-1",
          organizationId: "org-1",
          storeId: "store-1",
        },
      ],
    ]),
    serviceInventoryUsage: new Map(
      (args?.priorUsage ?? []).map((usage, index) => [
        `prior-usage-${index + 1}`,
        { _id: `prior-usage-${index + 1}`, ...usage },
      ]),
    ),
    store: new Map([
      ["store-1", { _id: "store-1", organizationId: "org-1" }],
    ]),
  };

  return {
    db: {
      get: vi.fn(async (table: string, id: string) =>
        rows[table]?.get(id) ?? null,
      ),
      insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
        const id = `${table}-${(rows[table]?.size ?? 0) + 1}`;
        rows[table] ??= new Map();
        rows[table].set(id, { _id: id, ...value });
        return id;
      }),
      patch: vi.fn(
        async (table: string, id: string, value: Record<string, unknown>) => {
          const row = rows[table]?.get(id);
          if (row) rows[table].set(id, { ...row, ...value });
        },
      ),
      query: vi.fn((table: string) => ({
        withIndex: vi.fn((_name: string, applyIndex: Function) => {
          const constraints: Record<string, unknown> = {};
          const builder = {
            eq(field: string, value: unknown) {
              constraints[field] = value;
              return builder;
            },
          };
          applyIndex(builder);
          const matching = () =>
            Array.from(rows[table]?.values() ?? []).filter((row) =>
              Object.entries(constraints).every(
                ([field, value]) => row[field] === value,
              ),
            );
          return {
            collect: vi.fn(async () => matching()),
            first: vi.fn(async () => matching()[0] ?? null),
          };
        }),
      })),
    },
    rows,
  };
}

describe("service ops schema foundations", () => {
  it("registers service tables with store-scoped indexes", () => {
    [
      {
        table: "serviceCatalog",
        descriptor: "by_storeId_slug",
        fields: ["storeId", "slug"],
      },
      {
        table: "serviceAppointment",
        descriptor: "by_staffProfileId_startAt",
        fields: ["assignedStaffProfileId", "startAt"],
      },
      {
        table: "serviceCase",
        descriptor: "by_operationalWorkItemId",
        fields: ["operationalWorkItemId"],
      },
      {
        table: "serviceCase",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "serviceCaseLineItem",
        descriptor: "by_serviceCaseId",
        fields: ["serviceCaseId"],
      },
      {
        table: "serviceInventoryUsage",
        descriptor: "by_serviceCaseId",
        fields: ["serviceCaseId"],
      },
    ].forEach(expectIndex);
  });

  it("keeps planned service material usage out of physical inventory", async () => {
    const ctx = createInventoryUsageCtx();

    await getHandler(recordServiceInventoryUsage)(ctx as never, {
      productSkuId: "sku-1",
      quantity: 1,
      serviceCaseId: "case-1",
      usageType: "planned",
    });

    expect(reportingMocks.applyInventoryEffectWithCtx).not.toHaveBeenCalled();
    expect(Array.from(ctx.rows.serviceInventoryUsage.values())).toContainEqual(
      expect.objectContaining({
        productSkuId: "sku-1",
        quantity: 1,
        usageType: "planned",
      }),
    );
  });

  it("records consumed service material as a deficit-safe outbound effect", async () => {
    const ctx = createInventoryUsageCtx();

    await getHandler(recordServiceInventoryUsage)(ctx as never, {
      productSkuId: "sku-1",
      quantity: 2,
      serviceCaseId: "case-1",
      usageType: "consumed",
    });

    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        compatibilityBalance: {
          onHandQuantity: 0,
          sellableQuantity: 0,
        },
        effectType: "adjustment",
        movementType: "service_material_consumed",
        physicalQuantityDelta: -2,
        sellableQuantityDelta: -1,
        sourceDomain: "service",
        sourceType: "service_inventory_usage",
        valuation: {
          disposition: "service_consumption",
          kind: "outbound",
          quantity: 2,
        },
      }),
    );
  });

  it("restores returned service material from linked outbound cost evidence", async () => {
    const ctx = createInventoryUsageCtx({
      inventoryEffect: {
        _id: "prior-effect",
        businessEventKey: "service_inventory_usage:prior-usage-1:consumed",
        costedQuantityDelta: -2,
        currencyCode: "GHS",
        outboundBasisMinor: 240,
        uncostedQuantityDelta: 0,
        unresolvedDeficitDelta: 0,
      },
      inventoryMovement: {
        _id: "prior-movement",
        businessEventKey: "service_inventory_usage:prior-usage-1:consumed",
        reportingInventoryEffectId: "prior-effect",
      },
      priorUsage: [
        {
          inventoryMovementId: "prior-movement",
          productSkuId: "sku-1",
          quantity: 2,
          serviceCaseId: "case-1",
          usageType: "consumed",
        },
      ],
    });

    await getHandler(recordServiceInventoryUsage)(ctx as never, {
      productSkuId: "sku-1",
      quantity: 1,
      serviceCaseId: "case-1",
      usageType: "returned",
    });

    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        effectType: "return",
        movementType: "service_material_returned",
        physicalQuantityDelta: 1,
        sellableQuantityDelta: 1,
        valuation: expect.objectContaining({
          disposition: "sellable",
          kind: "return",
          originalBasis: expect.objectContaining({
            allocatedKnownCost: 240,
            costedQuantity: 2,
            currency: "GHS",
          }),
          quantity: 1,
        }),
      }),
    );
  });

  it("keeps ambiguous service material returns explicitly uncosted", async () => {
    const ctx = createInventoryUsageCtx({
      priorUsage: [
        {
          productSkuId: "sku-1",
          quantity: 1,
          serviceCaseId: "case-1",
          usageType: "consumed",
        },
        {
          productSkuId: "sku-1",
          quantity: 1,
          serviceCaseId: "case-1",
          usageType: "consumed",
        },
      ],
    });

    await getHandler(recordServiceInventoryUsage)(ctx as never, {
      productSkuId: "sku-1",
      quantity: 1,
      serviceCaseId: "case-1",
      usageType: "returned",
    });

    expect(reportingMocks.applyInventoryEffectWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        valuation: expect.objectContaining({
          originalBasis: expect.objectContaining({
            allocatedKnownCost: 0,
            costedQuantity: 0,
            currency: null,
            uncostedQuantity: 1,
          }),
        }),
      }),
    );
  });

  it("recognizes standalone service revenue only when the case completes", async () => {
    const ctx = createInventoryUsageCtx();
    ctx.rows.serviceCase.set("case-1", {
      ...ctx.rows.serviceCase.get("case-1")!,
      notes: undefined,
      quotedAmount: 500,
      status: "in_progress",
    });
    ctx.rows.serviceCaseLineItem = new Map([
      [
        "line-1",
        {
          _id: "line-1",
          amount: 500,
          lineType: "labor",
          quantity: 1,
          serviceCaseId: "case-1",
        },
      ],
    ]);
    ctx.rows.paymentAllocation = new Map([
      [
        "payment-1",
        {
          _id: "payment-1",
          amount: 500,
          direction: "in",
          storeId: "store-1",
          targetId: "case-1",
          targetType: "service_case",
        },
      ],
    ]);
    ctx.rows.approvalRequest = new Map();
    ctx.rows.posTransactionServiceLine = new Map();

    const result = await getHandler(updateServiceCaseStatus)(ctx as never, {
      serviceCaseId: "case-1",
      status: "completed",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: expect.objectContaining({ status: "completed" }),
    });
    expect(reportingMocks.applyInventoryEffectWithCtx).not.toHaveBeenCalled();
    const { appendReportingIngressWithCtx } = await import(
      "../reporting/ingress"
    );
    expect(appendReportingIngressWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        businessEventKey: "service:case-1:complete",
        lines: [
          expect.objectContaining({
            lineKind: "service",
            serviceCaseId: "case-1",
          }),
        ],
        sourceEventType: "service_completed",
      }),
    );
  });

  it("does not recognize service completion again when POS owns the sale", async () => {
    const ctx = createInventoryUsageCtx();
    ctx.rows.serviceCase.set("case-1", {
      ...ctx.rows.serviceCase.get("case-1")!,
      quotedAmount: 0,
      status: "in_progress",
    });
    ctx.rows.serviceCaseLineItem = new Map();
    ctx.rows.paymentAllocation = new Map();
    ctx.rows.approvalRequest = new Map();
    ctx.rows.posTransactionServiceLine = new Map([
      [
        "pos-service-line-1",
        {
          _id: "pos-service-line-1",
          serviceCaseId: "case-1",
          transactionId: "txn-1",
        },
      ],
    ]);

    await getHandler(updateServiceCaseStatus)(ctx as never, {
      serviceCaseId: "case-1",
      status: "completed",
    });

    expect(reportingMocks.appendReportingIngressWithCtx).not.toHaveBeenCalled();
  });

  it("allows only supported service-case transitions", () => {
    expect(
      assertValidServiceCaseStatusTransition("intake", "in_progress")
    ).toEqual({ kind: "ok", data: null });
    expect(
      assertValidServiceCaseStatusTransition("in_progress", "awaiting_pickup")
    ).toEqual({ kind: "ok", data: null });
    expect(
      assertValidServiceCaseStatusTransition("completed", "in_progress")
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Invalid service case status transition.",
      },
    });
    expect(
      assertValidServiceCaseStatusTransition("cancelled", "completed")
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Invalid service case status transition.",
      },
    });
  });

  it("maps terminal service-case statuses out of Open Work", () => {
    expect(mapServiceCaseStatusToWorkItemStatus("intake")).toBe("open");
    expect(mapServiceCaseStatusToWorkItemStatus("scheduled")).toBe("open");
    expect(mapServiceCaseStatusToWorkItemStatus("in_progress")).toBe(
      "in_progress",
    );
    expect(mapServiceCaseStatusToWorkItemStatus("awaiting_approval")).toBe(
      "in_progress",
    );
    expect(mapServiceCaseStatusToWorkItemStatus("awaiting_pickup")).toBe(
      "in_progress",
    );
    expect(mapServiceCaseStatusToWorkItemStatus("completed")).toBe("completed");
    expect(mapServiceCaseStatusToWorkItemStatus("cancelled")).toBe("cancelled");
  });

  it("shapes service cases and line items with persistence-safe defaults", () => {
    const serviceCase = buildServiceCase({
      assignedStaffProfileId: "staff_1" as Id<"staffProfile">,
      createdByUserId: "user_1" as Id<"athenaUser">,
      customerProfileId: "customer_1" as Id<"customerProfile">,
      operationalWorkItemId: "work_item_1" as Id<"operationalWorkItem">,
      quotedAmount: 450,
      serviceMode: "same_day",
      storeId: "store_1" as Id<"store">,
    });

    expect(serviceCase).toMatchObject({
      assignedStaffProfileId: "staff_1",
      balanceDueAmount: 450,
      paymentStatus: "unpaid",
      serviceMode: "same_day",
      status: "intake",
    });
    expect(serviceCase).not.toHaveProperty("createdByUserId");

    expect(
      buildServiceCaseLineItem({
        description: "Closure repair mesh",
        lineType: "material",
        quantity: 0,
        serviceCaseId: "case_1" as Id<"serviceCase">,
        unitPrice: 50,
      })
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Line item quantity must be greater than zero.",
      },
    });

    expect(
      buildServiceCaseLineItem({
        description: "Wash and restyle",
        lineType: "labor",
        quantity: 2,
        serviceCaseId: "case_1" as Id<"serviceCase">,
        unitPrice: 150,
      })
    ).toMatchObject({
      kind: "ok",
      data: {
        amount: 300,
        quantity: 2,
        unitPrice: 150,
      },
    });
  });
});
