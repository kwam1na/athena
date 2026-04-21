import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildPaymentAllocation,
  summarizePaymentAllocations,
} from "./paymentAllocations";

describe("payment allocation helpers", () => {
  it("builds incoming payment allocations with store-collection metadata", () => {
    const allocation = buildPaymentAllocation({
      storeId: "store_1" as Id<"store">,
      targetType: "service_intake",
      targetId: "intake_1",
      allocationType: "deposit",
      method: "cash",
      amount: 2500,
      collectedInStore: true,
    });

    expect(allocation).toMatchObject({
      storeId: "store_1",
      targetType: "service_intake",
      allocationType: "deposit",
      direction: "in",
      method: "cash",
      amount: 2500,
      collectedInStore: true,
      status: "recorded",
    });
    expect(allocation.recordedAt).toEqual(expect.any(Number));
  });

  it("summarizes in and out allocations into a net amount", () => {
    expect(
      summarizePaymentAllocations([
        { direction: "in", amount: 8000 },
        { direction: "out", amount: 2500 },
        { direction: "in", amount: 1000 },
      ])
    ).toEqual({
      totalIn: 9000,
      totalOut: 2500,
      netAmount: 6500,
    });
  });
});
