import { beforeEach, describe, expect, it, vi } from "vitest";
import { Id } from "../_generated/dataModel";
import * as athenaUserAuth from "../lib/athenaUserAuth";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  buildPosServiceCatalogRow,
  buildServiceCatalogItem,
  listPosServiceCatalogSnapshotWithCtx,
  listPosServiceCatalogSnapshot,
  normalizeServiceCatalogNameKey,
} from "./catalog";
import {
  buildServiceAppointment,
  cancelAppointment,
  closeCurrentServiceAppointmentWorkItemsWithCtx,
  convertAppointmentToWalkIn,
  findOverlappingAppointment,
} from "./appointments";

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(athenaUserAuth.requireAuthenticatedAthenaUserWithCtx).mockResolvedValue({
    _id: "user-admin" as Id<"athenaUser">,
  } as never);
  vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockResolvedValue(
    {
      _id: "member-1",
      organizationId: "org-1",
      role: "full_admin",
      userId: "user-admin",
    } as never,
  );
});

describe("service catalog and appointment helpers", () => {
  it("lists POS service catalog snapshot rows without requiring admin auth", async () => {
    const storeId = "store_1" as Id<"store">;
    const activeRows = [
      {
        _id: "catalog-fixed" as Id<"serviceCatalog">,
        basePrice: 4_500,
        createdAt: 900,
        depositType: "flat" as const,
        depositValue: 1_000,
        durationMinutes: 90,
        name: "Closure Repair",
        pricingModel: "fixed" as const,
        requiresManagerApproval: false,
        serviceMode: "repair" as const,
        slug: "closure-repair",
        status: "active" as const,
        storeId,
        updatedAt: 1_000,
      },
    ];
    const queryBuilder = {
      eq: vi.fn(),
    };
    queryBuilder.eq.mockReturnValue(queryBuilder);
    const collect = vi.fn(async () => activeRows);
    const withIndex = vi.fn((_indexName, callback) => {
      callback(queryBuilder);
      return { collect };
    });
    const query = vi.fn(() => ({ withIndex }));
    const get = vi.fn(async (tableName, id) => {
      if (tableName === "store" && id === storeId) {
        return {
          _id: storeId,
          organizationId: "org_1" as Id<"organization">,
        };
      }

      return null;
    });

    const rows = await listPosServiceCatalogSnapshotWithCtx(
      {
        db: { get, query },
      } as never,
      { storeId },
    );

    expect(get).toHaveBeenCalledWith("store", storeId);
    expect(query).toHaveBeenCalledWith("serviceCatalog");
    expect(withIndex).toHaveBeenCalledWith(
      "by_storeId_status",
      expect.any(Function),
    );
    expect(queryBuilder.eq).toHaveBeenNthCalledWith(1, "storeId", storeId);
    expect(queryBuilder.eq).toHaveBeenNthCalledWith(2, "status", "active");
    expect(collect).toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({
        name: "Closure Repair",
        serviceCatalogId: "catalog-fixed",
        status: "active",
      }),
    ]);
    assertConformsToExportedReturns(listPosServiceCatalogSnapshot, rows);
  });

  it("normalizes service catalog names case-insensitively for uniqueness", () => {
    expect(normalizeServiceCatalogNameKey("Tokin")).toBe("tokin");
    expect(normalizeServiceCatalogNameKey("tokin")).toBe("tokin");
    expect(normalizeServiceCatalogNameKey("  TOKIN  ")).toBe("tokin");
  });

  it("normalizes catalog items and returns user_error data for expected validation failures", () => {
    expect(
      buildServiceCatalogItem({
        depositType: "flat",
        depositValue: 100,
        durationMinutes: 0,
        name: "Closure Repair",
        pricingModel: "fixed",
        requiresManagerApproval: false,
        serviceMode: "repair",
        storeId: "store_1" as Id<"store">,
      })
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Service duration must be greater than zero.",
      },
    });

    expect(
      buildServiceCatalogItem({
        basePrice: 450,
        depositType: "percentage",
        depositValue: 150,
        durationMinutes: 90,
        name: "Closure Repair",
        pricingModel: "fixed",
        requiresManagerApproval: false,
        serviceMode: "repair",
        storeId: "store_1" as Id<"store">,
      })
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Percentage deposit must be between 1 and 100.",
      },
    });

    expect(
      buildServiceCatalogItem({
        basePrice: 450,
        depositType: "flat",
        depositValue: 100,
        durationMinutes: 90,
        name: "Closure Repair",
        pricingModel: "fixed",
        requiresManagerApproval: false,
        serviceMode: "repair",
        storeId: "store_1" as Id<"store">,
      })
    ).toMatchObject({
      kind: "ok",
      data: {
        durationMinutes: 90,
        slug: "closure-repair",
        status: "active",
      },
    });
  });

  it("maps active service catalog items into POS checkout readiness rows", () => {
    const fixed = buildPosServiceCatalogRow({
      _id: "catalog-fixed" as Id<"serviceCatalog">,
      basePrice: 4_500,
      depositType: "flat",
      depositValue: 1_000,
      name: "Closure Repair",
      pricingModel: "fixed",
      requiresManagerApproval: false,
      serviceMode: "repair",
      status: "active",
      updatedAt: 1_000,
    });
    const startingAt = buildPosServiceCatalogRow({
      _id: "catalog-starting" as Id<"serviceCatalog">,
      basePrice: 8_000,
      depositType: "percentage",
      depositValue: 50,
      name: "Wig Revamp",
      pricingModel: "starting_at",
      requiresManagerApproval: true,
      serviceMode: "revamp",
      status: "active",
      updatedAt: 1_001,
    });
    const quote = buildPosServiceCatalogRow({
      _id: "catalog-quote" as Id<"serviceCatalog">,
      depositType: "none",
      name: "Custom Consultation",
      pricingModel: "quote_after_consultation",
      requiresManagerApproval: true,
      serviceMode: "consultation",
      status: "active",
      updatedAt: 1_002,
    });

    expect(fixed).toMatchObject({
      checkoutReadiness: {
        canCheckoutDirectly: true,
        reason: "fixed_price",
        status: "ready",
        suggestedAmount: 4_500,
        minimumAmount: 1_000,
      },
      status: "active",
    });
    expect(startingAt).toMatchObject({
      checkoutReadiness: {
        canCheckoutDirectly: false,
        reason: "starting_at_amount_required",
        status: "amount_required",
        suggestedAmount: 4_000,
      },
    });
    expect(quote).toMatchObject({
      checkoutReadiness: {
        canCheckoutDirectly: false,
        reason: "quote_after_consultation_requires_case_or_amount",
        requiresExistingCaseOrAmount: true,
        status: "case_or_amount_required",
      },
    });
  });

  it("keeps archived service catalog items out of POS rows", () => {
    expect(
      buildPosServiceCatalogRow({
        _id: "catalog-archived" as Id<"serviceCatalog">,
        basePrice: 4_500,
        depositType: "none",
        name: "Archived Repair",
        pricingModel: "fixed",
        requiresManagerApproval: false,
        serviceMode: "repair",
        status: "archived",
        updatedAt: 1_003,
      }),
    ).toBeNull();
  });

  it("returns a validation_failed user_error for invalid appointment duration", () => {
    expect(
      buildServiceAppointment({
        assignedStaffProfileId: "staff_1" as Id<"staffProfile">,
        customerProfileId: "customer_1" as Id<"customerProfile">,
        durationMinutes: 0,
        serviceCatalogId: "catalog_1" as Id<"serviceCatalog">,
        startAt: 1_000,
        storeId: "store_1" as Id<"store">,
      })
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Service duration must be greater than zero.",
      },
    });
  });

  it("builds appointments with computed end times and default status", () => {
    expect(
      buildServiceAppointment({
        assignedStaffProfileId: "staff_1" as Id<"staffProfile">,
        customerProfileId: "customer_1" as Id<"customerProfile">,
        durationMinutes: 90,
        serviceCatalogId: "catalog_1" as Id<"serviceCatalog">,
        startAt: 1_000,
        storeId: "store_1" as Id<"store">,
      })
    ).toMatchObject({
      kind: "ok",
      data: {
        endAt: 5_401_000,
        status: "scheduled",
      },
    });
  });

  it("detects overlapping active appointments while ignoring cancelled ones", () => {
    const overlap = findOverlappingAppointment(
      [
        {
          _id: "appointment_1",
          endAt: 200,
          startAt: 100,
          status: "scheduled",
        },
        {
          _id: "appointment_2",
          endAt: 240,
          startAt: 180,
          status: "cancelled",
        },
      ],
      {
        endAt: 250,
        startAt: 150,
      }
    );

    expect(overlap?._id).toBe("appointment_1");
    expect(
      findOverlappingAppointment(
        [
          {
            _id: "appointment_2",
            endAt: 240,
            startAt: 180,
            status: "cancelled",
          },
        ],
        {
          endAt: 250,
          startAt: 150,
        }
      )
    ).toBeNull();
  });

  it("terminal appointment transitions patch only current work for the appointment source", async () => {
    const patch = vi.fn();
    const workItems: Array<Record<string, unknown>> = [
      {
        _id: "work-current-open",
        appointmentId: "appointment-1",
        metadata: { appointmentId: "appointment-1" },
        status: "open",
        storeId: "store-1",
        type: "service_appointment",
      },
      {
        _id: "work-other-appointment",
        appointmentId: "appointment-2",
        metadata: { appointmentId: "appointment-2" },
        status: "open",
        storeId: "store-1",
        type: "service_appointment",
      },
      {
        _id: "work-current-progress",
        metadata: { appointmentId: "appointment-1" },
        status: "in_progress",
        storeId: "store-1",
        type: "service_appointment",
      },
    ];
    const ctx = {
      db: {
        get: vi.fn(async (_table: string, id: string) => ({
          _id: id,
        })),
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(
            (
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) => {
              const constraints = new Map<string, unknown>();
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  constraints.set(field, value);
                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);
              const matchingRows = () =>
                workItems.filter((workItem) =>
                  Array.from(constraints.entries()).every(
                    ([field, value]) => workItem[field] === value,
                  ),
                );

              return {
                collect: vi.fn(async () => matchingRows()),
                take: vi.fn(async (limit: number) =>
                  matchingRows().slice(0, limit),
                ),
              };
            },
          ),
        })),
      },
    };

    const patchedIds = await closeCurrentServiceAppointmentWorkItemsWithCtx(
      ctx as never,
      {
        appointmentId: "appointment-1" as Id<"serviceAppointment">,
        status: "completed",
        storeId: "store-1" as Id<"store">,
      },
    );

    expect(patchedIds).toEqual(["work-current-open", "work-current-progress"]);
    expect(patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-current-open",
      expect.objectContaining({ status: "completed" }),
    );
    expect(patch).toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-current-progress",
      expect.objectContaining({ status: "completed" }),
    );
    expect(patch).not.toHaveBeenCalledWith(
      "operationalWorkItem",
      "work-other-appointment",
      expect.anything(),
    );
  });

  it("requires full-admin access before terminal appointment mutations write", async () => {
    vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockRejectedValue(
      new Error("Only store admins can update service appointments."),
    );
    const cancelCtx = createAppointmentMutationCtx();

    await expect(
      getHandler(cancelAppointment)(cancelCtx, {
        appointmentId: "appointment-1" as Id<"serviceAppointment">,
      }),
    ).rejects.toThrow("Only store admins can update service appointments.");
    expect(cancelCtx.db.patch).not.toHaveBeenCalled();
    expect(cancelCtx.db.insert).not.toHaveBeenCalled();

    vi.mocked(athenaUserAuth.requireOrganizationMemberRoleWithCtx).mockRejectedValue(
      new Error("Only store admins can convert service appointments to cases."),
    );
    const convertCtx = createAppointmentMutationCtx();

    await expect(
      getHandler(convertAppointmentToWalkIn)(convertCtx, {
        appointmentId: "appointment-1" as Id<"serviceAppointment">,
        createdByUserId: "user-spoof" as Id<"athenaUser">,
      }),
    ).rejects.toThrow(
      "Only store admins can convert service appointments to cases.",
    );
    expect(convertCtx.db.patch).not.toHaveBeenCalled();
    expect(convertCtx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects appointment cancellation when the appointment store belongs to another organization", async () => {
    const ctx = createAppointmentMutationCtx();
    ctx.rows.store.set("store-1", {
      _id: "store-1",
      organizationId: "org-other",
    });

    const result = await getHandler(cancelAppointment)(ctx, {
      appointmentId: "appointment-1" as Id<"serviceAppointment">,
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Appointment store does not match its organization.",
      },
    });
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects appointment conversion when the appointment store belongs to another organization", async () => {
    const ctx = createAppointmentMutationCtx();
    ctx.rows.store.set("store-1", {
      _id: "store-1",
      organizationId: "org-other",
    });

    const result = await getHandler(convertAppointmentToWalkIn)(ctx, {
      appointmentId: "appointment-1" as Id<"serviceAppointment">,
      createdByUserId: "user-spoof" as Id<"athenaUser">,
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Appointment store does not match its organization.",
      },
    });
    expect(
      athenaUserAuth.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("rejects conversion for cancelled appointments before creating case work", async () => {
    const ctx = createAppointmentMutationCtx();
    ctx.rows.serviceAppointment.set("appointment-1", {
      ...ctx.rows.serviceAppointment.get("appointment-1"),
      status: "cancelled",
    });

    const result = await getHandler(convertAppointmentToWalkIn)(ctx, {
      appointmentId: "appointment-1" as Id<"serviceAppointment">,
      createdByUserId: "user-spoof" as Id<"athenaUser">,
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "This appointment can no longer be converted.",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("attributes walk-in conversion to the authenticated user instead of the caller supplied user", async () => {
    const ctx = createAppointmentMutationCtx();

    const result = await getHandler(convertAppointmentToWalkIn)(ctx, {
      appointmentId: "appointment-1" as Id<"serviceAppointment">,
      createdByUserId: "user-spoof" as Id<"athenaUser">,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        serviceCaseId: "serviceCase-1",
        workItemId: "operationalWorkItem-1",
      },
    });
    expect(ctx.staffLookupConstraints).toContainEqual({
      linkedUserId: "user-admin",
      storeId: "store-1",
    });
    expect(ctx.inserts).toContainEqual(
      expect.objectContaining({
        table: "operationalWorkItem",
        value: expect.objectContaining({
          createdByStaffProfileId: "staff-admin",
          createdByUserId: "user-admin",
          metadata: expect.objectContaining({
            appointmentId: "appointment-1",
            serviceCatalogId: "catalog-1",
            startAt: 1_772_550_000_000,
          }),
          type: "service_case",
        }),
      }),
    );
    expect(ctx.inserts).toContainEqual(
      expect.objectContaining({
        table: "operationalEvent",
        value: expect.objectContaining({
          actorUserId: "user-admin",
          eventType: "service_case_created",
        }),
      }),
    );
    expect(ctx.inserts).toContainEqual(
      expect.objectContaining({
        table: "operationalEvent",
        value: expect.objectContaining({
          actorStaffProfileId: "staff-admin",
          actorUserId: "user-admin",
          eventType: "service_appointment_converted_to_walk_in",
        }),
      }),
    );
    expect(JSON.stringify(ctx.inserts)).not.toContain("user-spoof");
  });

  it("attributes appointment cancellation events to the authenticated user", async () => {
    const ctx = createAppointmentMutationCtx();

    const result = await getHandler(cancelAppointment)(ctx, {
      appointmentId: "appointment-1" as Id<"serviceAppointment">,
      notes: "Customer cancelled.",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "appointment-1",
        status: "cancelled",
      },
    });
    await expect(
      ctx.db.get("operationalWorkItem", "work-appointment-1"),
    ).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(ctx.inserts).toContainEqual(
      expect.objectContaining({
        table: "operationalEvent",
        value: expect.objectContaining({
          actorStaffProfileId: "staff-admin",
          actorUserId: "user-admin",
          eventType: "service_appointment_cancelled",
          metadata: expect.objectContaining({
            nextWorkItemStatus: "cancelled",
            previousStatus: "scheduled",
          }),
        }),
      }),
    );
  });
});

function createAppointmentMutationCtx() {
  const now = 1_772_550_000_000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const staffLookupConstraints: Array<Record<string, unknown>> = [];
  const rows: Record<string, Map<string, Record<string, unknown>>> = {
    customerProfile: new Map([
      [
        "customer-1",
        {
          _id: "customer-1",
          storeId: "store-1",
        },
      ],
    ]),
    operationalWorkItem: new Map([
      [
        "work-appointment-1",
        {
          _id: "work-appointment-1",
          approvalState: "not_required",
          createdAt: now - 1,
          metadata: {
            appointmentId: "appointment-1",
          },
          organizationId: "org-1",
          priority: "normal",
          status: "open",
          storeId: "store-1",
          title: "Closure Repair appointment",
          type: "service_appointment",
        },
      ],
    ]),
    serviceAppointment: new Map([
      [
        "appointment-1",
        {
          _id: "appointment-1",
          assignedStaffProfileId: "staff-assigned",
          customerProfileId: "customer-1",
          durationMinutes: 60,
          endAt: now + 60 * 60 * 1000,
          notes: "Walk-in ready",
          organizationId: "org-1",
          serviceCatalogId: "catalog-1",
          startAt: now,
          status: "scheduled",
          storeId: "store-1",
        },
      ],
    ]),
    serviceCase: new Map(),
    serviceCatalog: new Map([
      [
        "catalog-1",
        {
          _id: "catalog-1",
          basePrice: 4_500,
          name: "Closure Repair",
          serviceMode: "repair",
          storeId: "store-1",
        },
      ],
    ]),
    staffProfile: new Map([
      [
        "staff-admin",
        {
          _id: "staff-admin",
          linkedUserId: "user-admin",
          storeId: "store-1",
        },
      ],
    ]),
    store: new Map([
      [
        "store-1",
        {
          _id: "store-1",
          organizationId: "org-1",
        },
      ],
    ]),
  };
  const get = vi.fn(async (tableName: string, id: string) => {
    return rows[tableName]?.get(id) ?? null;
  });
  const patch = vi.fn(
    async (tableName: string, id: string, patchValue: Record<string, unknown>) => {
      const row = rows[tableName]?.get(id);
      if (row) {
        rows[tableName].set(id, { ...row, ...patchValue });
      }
    },
  );
  const insert = vi.fn(async (tableName: string, value: Record<string, unknown>) => {
    const id = `${tableName}-1`;
    inserts.push({ table: tableName, value });
    rows[tableName] ??= new Map();
    rows[tableName].set(id, { _id: id, ...value });
    return id;
  });
  const query = vi.fn((tableName: string) => ({
    withIndex: vi.fn((_indexName: string, applyIndex: Function) => {
      const constraints: Record<string, unknown> = {};
      const queryBuilder = {
        eq(field: string, value: unknown) {
          constraints[field] = value;
          return queryBuilder;
        },
      };
      applyIndex(queryBuilder);

      if (tableName === "staffProfile") {
        staffLookupConstraints.push({ ...constraints });
      }

      const matchingRows = () =>
        Array.from(rows[tableName]?.values() ?? []).filter((row) =>
          Object.entries(constraints).every(([field, value]) => row[field] === value),
        );

      return {
        collect: vi.fn(async () => matchingRows()),
        first: vi.fn(async () => matchingRows()[0] ?? null),
        order: vi.fn(() => ({
          first: vi.fn(async () => matchingRows()[0] ?? null),
        })),
        take: vi.fn(async (limit: number) => matchingRows().slice(0, limit)),
        unique: vi.fn(async () => matchingRows()[0] ?? null),
      };
    }),
  }));

  return {
    db: {
      get,
      insert,
      patch,
      query,
    },
    inserts,
    rows,
    staffLookupConstraints,
  };
}
