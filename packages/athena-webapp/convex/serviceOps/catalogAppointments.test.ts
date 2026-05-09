import { describe, expect, it } from "vitest";
import { Id } from "../_generated/dataModel";
import {
  buildServiceCatalogItem,
  normalizeServiceCatalogNameKey,
} from "./catalog";
import {
  buildServiceAppointment,
  findOverlappingAppointment,
} from "./appointments";

describe("service catalog and appointment helpers", () => {
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
});
