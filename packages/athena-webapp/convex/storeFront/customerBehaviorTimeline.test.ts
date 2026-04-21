import { describe, expect, it } from "vitest";

import {
  getCustomerOperationalTimelineEvents,
  resolveCustomerProfileIdForTimeline,
} from "./customerBehaviorTimeline";

function createQueryCtx({
  guest,
  guestProfile,
  loyaltyEvents,
  onlineOrder,
  onlineOrderEvents,
  storeFrontProfile,
  storeFrontUser,
}: {
  guest?: { _id: string } | null;
  guestProfile?: { _id: string } | null;
  loyaltyEvents?: Array<Record<string, unknown>>;
  onlineOrder?: { _id: string; orderNumber?: string } | null;
  onlineOrderEvents?: Array<Record<string, unknown>>;
  storeFrontProfile?: { _id: string } | null;
  storeFrontUser?: { _id: string } | null;
}) {
  return {
    db: {
      async get(table: string, id: string) {
        if (table === "storeFrontUser" && storeFrontUser?._id === id) {
          return storeFrontUser;
        }

        if (table === "guest" && guest?._id === id) {
          return guest;
        }

        if (table === "onlineOrder" && onlineOrder?._id === id) {
          return onlineOrder;
        }

        return null;
      },
      query(table: string) {
        if (table === "customerProfile") {
          return {
            withIndex(index: string) {
              return {
                async first() {
                  if (index === "by_storeFrontUserId") {
                    return storeFrontProfile ?? null;
                  }

                  if (index === "by_guestId") {
                    return guestProfile ?? null;
                  }

                  return null;
                },
              };
            },
          };
        }

        if (table === "operationalEvent") {
          return {
            withIndex(index: string) {
              expect(index).toBe("by_customerProfileId");

              return {
                order() {
                  return {
                    async take() {
                      return [
                        ...(onlineOrderEvents ?? []),
                        ...(loyaltyEvents ?? []),
                      ];
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;
}

describe("resolveCustomerProfileIdForTimeline", () => {
  it("resolves a registered storefront user through the shared customer profile", async () => {
    const customerProfileId = await resolveCustomerProfileIdForTimeline(
      createQueryCtx({
        storeFrontProfile: { _id: "customer_storefront_1" },
        storeFrontUser: { _id: "storefront_1" },
      }),
      "storefront_1" as any,
    );

    expect(customerProfileId).toBe("customer_storefront_1");
  });

  it("falls back to a guest-linked customer profile when the actor is a guest", async () => {
    const customerProfileId = await resolveCustomerProfileIdForTimeline(
      createQueryCtx({
        guest: { _id: "guest_1" },
        guestProfile: { _id: "customer_guest_1" },
      }),
      "guest_1" as any,
    );

    expect(customerProfileId).toBe("customer_guest_1");
  });
});

describe("getCustomerOperationalTimelineEvents", () => {
  it("keeps loyalty and follow-up milestones in the Athena customer timeline", async () => {
    const events = await getCustomerOperationalTimelineEvents(
      createQueryCtx({
        loyaltyEvents: [
          {
            _id: "loyalty_event_1",
            createdAt: 250,
            customerProfileId: "customer_storefront_1",
            eventType: "loyalty_points_awarded",
            message: "Awarded 120 loyalty points after checkout.",
            metadata: { points: 120 },
            storeId: "store_1",
            subjectId: "reward_txn_1",
            subjectLabel: "120 points",
            subjectType: "loyalty",
          },
          {
            _id: "follow_up_event_1",
            createdAt: 225,
            customerProfileId: "customer_storefront_1",
            eventType: "follow_up_offer_sent",
            message: "Sent WELCOME25 follow-up offer email.",
            metadata: { promoCode: "WELCOME25" },
            storeId: "store_1",
            subjectId: "offer_1",
            subjectLabel: "WELCOME25",
            subjectType: "follow_up",
          },
        ],
        onlineOrder: { _id: "order_1", orderNumber: "ORD-1001" },
        onlineOrderEvents: [
          {
            _id: "order_event_1",
            createdAt: 300,
            customerProfileId: "customer_storefront_1",
            eventType: "online_order_ready_for_pickup",
            onlineOrderId: "order_1",
            storeId: "store_1",
            subjectId: "order_1",
            subjectType: "online_order",
          },
        ],
        storeFrontProfile: { _id: "customer_storefront_1" },
        storeFrontUser: { _id: "storefront_1" },
      }),
      "storefront_1" as any,
      20,
    );

    expect(events).toMatchObject([
      {
        _id: "order_event_1",
        eventType: "online_order_ready_for_pickup",
        subjectLabel: "ORD-1001",
        subjectType: "online_order",
      },
      {
        _id: "loyalty_event_1",
        eventType: "loyalty_points_awarded",
        subjectLabel: "120 points",
        subjectType: "loyalty",
      },
      {
        _id: "follow_up_event_1",
        eventType: "follow_up_offer_sent",
        subjectLabel: "WELCOME25",
        subjectType: "follow_up",
      },
    ]);
  });
});
