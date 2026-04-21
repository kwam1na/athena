import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildInStorePaymentAllocations,
  normalizeInStorePayments,
  selectRegisterSessionForAttribution,
} from "./paymentAllocationAttribution";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("cash-control payment allocation attribution", () => {
  it("normalizes split payments so change only reduces retained cash", () => {
    expect(
      normalizeInStorePayments({
        changeGiven: 2000,
        payments: [
          { amount: 9000, method: "cash", timestamp: 1 },
          { amount: 3000, method: "card", timestamp: 2 },
        ],
      })
    ).toEqual([
      { amount: 7000, method: "cash", timestamp: 1 },
      { amount: 3000, method: "card", timestamp: 2 },
    ]);

    expect(
      normalizeInStorePayments({
        changeGiven: 1000,
        payments: [
          { amount: 4000, method: "cash", timestamp: 1 },
          { amount: 3000, method: "cash", timestamp: 2 },
        ],
      })
    ).toEqual([
      { amount: 4000, method: "cash", timestamp: 1 },
      { amount: 2000, method: "cash", timestamp: 2 },
    ]);
  });

  it("builds one retained allocation per payment with register-session metadata", () => {
    const allocations = buildInStorePaymentAllocations({
      allocationType: "retail_sale",
      changeGiven: 1000,
      externalReferencePrefix: "tx-123",
      payments: [
        { amount: 9000, method: "cash", timestamp: 1 },
        { amount: 3000, method: "card", timestamp: 2 },
      ],
      registerSessionId: "session_1" as Id<"registerSession">,
      storeId: "store_1" as Id<"store">,
      targetId: "transaction_1",
      targetType: "pos_transaction",
    });

    expect(allocations).toEqual([
      expect.objectContaining({
        allocationType: "retail_sale",
        amount: 8000,
        collectedInStore: true,
        externalReference: "tx-123:0",
        method: "cash",
        registerSessionId: "session_1",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      }),
      expect.objectContaining({
        allocationType: "retail_sale",
        amount: 3000,
        collectedInStore: true,
        externalReference: "tx-123:1",
        method: "card",
        registerSessionId: "session_1",
        storeId: "store_1",
        targetId: "transaction_1",
        targetType: "pos_transaction",
      }),
    ]);
  });

  it("prefers an explicit session and refuses ambiguous actor-owned sessions", () => {
    const explicitSessionId = selectRegisterSessionForAttribution({
      actorUserId: "user_1" as Id<"athenaUser">,
      registerSessionId: "session_explicit" as Id<"registerSession">,
      sessions: [
        {
          _id: "session_a" as Id<"registerSession">,
          openedByUserId: "user_2" as Id<"athenaUser">,
          status: "active",
        },
      ],
    });

    expect(explicitSessionId).toBe("session_explicit");

    expect(
      selectRegisterSessionForAttribution({
        actorUserId: "user_1" as Id<"athenaUser">,
        sessions: [
          {
            _id: "session_a" as Id<"registerSession">,
            openedByUserId: "user_1" as Id<"athenaUser">,
            status: "active",
          },
          {
            _id: "session_b" as Id<"registerSession">,
            openedByUserId: "user_1" as Id<"athenaUser">,
            status: "open",
          },
        ],
      })
    ).toBeUndefined();

    expect(
      selectRegisterSessionForAttribution({
        actorStaffProfileId: "staff_1" as Id<"staffProfile">,
        sessions: [
          {
            _id: "session_staff" as Id<"registerSession">,
            openedByStaffProfileId: "staff_1" as Id<"staffProfile">,
            status: "active",
          },
        ],
      })
    ).toBe("session_staff");

    expect(
      selectRegisterSessionForAttribution({
        sessions: [
          {
            _id: "session_only" as Id<"registerSession">,
            status: "open",
          },
        ],
      })
    ).toBe("session_only");
  });

  it("threads attribution helpers through the cash-bearing service, order, and POS flows", () => {
    const serviceIntake = readProjectFile("convex", "operations", "serviceIntake.ts");
    const orderOperations = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "orderOperations.ts"
    );
    const serviceCases = readProjectFile(
      "convex",
      "serviceOps",
      "serviceCases.ts"
    );
    const pos = readProjectFile(
      "convex",
      "pos",
      "infrastructure",
      "integrations",
      "paymentAllocationService.ts"
    );

    expect(serviceIntake).toContain("resolveRegisterSessionForInStoreCollectionWithCtx");
    expect(serviceIntake).toContain('args.intakeChannel === "walk_in"');
    expect(serviceIntake).toContain("registerSessionId: resolvedRegisterSessionId");

    expect(orderOperations).toContain('args.order.deliveryMethod === "pickup"');
    expect(orderOperations).toContain("resolveRegisterSessionForInStoreCollectionWithCtx");
    expect(orderOperations).toContain("registerSessionId: resolvedRegisterSessionId");

    expect(serviceCases).toContain("resolveRegisterSessionForInStoreCollectionWithCtx");
    expect(serviceCases).toContain("registerSessionId: resolvedRegisterSessionId");

    expect(pos).toContain("buildInStorePaymentAllocations");
    expect(pos).toContain("recordPaymentAllocationWithCtx");
  });
});
