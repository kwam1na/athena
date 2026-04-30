import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildPaymentAllocation,
  findSameAmountSinglePaymentAllocation,
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

  it("characterizes correction support as one recorded incoming allocation with the same amount", () => {
    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            method: "cash",
            amount: 2500,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toMatchObject({
      _id: "allocation_1",
      method: "cash",
      amount: 2500,
    });
  });

  it("does not support payment-method correction when allocation cardinality or amount changes", () => {
    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            method: "cash",
            amount: 1500,
            status: "recorded",
          },
          {
            _id: "allocation_2" as Id<"paymentAllocation">,
            direction: "in",
            method: "card",
            amount: 1000,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toBeNull();

    expect(
      findSameAmountSinglePaymentAllocation(
        [
          {
            _id: "allocation_1" as Id<"paymentAllocation">,
            direction: "in",
            method: "cash",
            amount: 2000,
            status: "recorded",
          },
        ],
        { amount: 2500 },
      ),
    ).toBeNull();
  });
});
