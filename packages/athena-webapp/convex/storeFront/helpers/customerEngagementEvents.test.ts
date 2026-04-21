import { describe, expect, it } from "vitest";

import { recordStoreFrontCustomerMilestone } from "./customerEngagementEvents";

function createMutationCtx({
  guest,
  guestProfile,
  store,
  storeFrontProfile,
  storeFrontUser,
}: {
  guest?: { _id: string } | null;
  guestProfile?: { _id: string } | null;
  store?: { _id: string; organizationId?: string } | null;
  storeFrontProfile?: { _id: string } | null;
  storeFrontUser?: { _id: string } | null;
}) {
  const insertedEvents: Array<Record<string, unknown>> = [];

  return {
    ctx: {
      db: {
        async get(table: string, id: string) {
          if (table === "store" && store?._id === id) {
            return store;
          }

          if (table === "storeFrontUser" && storeFrontUser?._id === id) {
            return storeFrontUser;
          }

          if (table === "guest" && guest?._id === id) {
            return guest;
          }

          if (table === "operationalEvent" && id === "operational_event_1") {
            return {
              _id: "operational_event_1",
              ...insertedEvents.at(-1),
            };
          }

          return null;
        },
        async insert(table: string, value: Record<string, unknown>) {
          expect(table).toBe("operationalEvent");
          insertedEvents.push(value);
          return "operational_event_1";
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
                expect(index).toBe("by_storeId_subject");

                return {
                  collect: async () => [],
                };
              },
            };
          }

          throw new Error(`Unexpected table query: ${table}`);
        },
      },
    } as any,
    insertedEvents,
  };
}

describe("recordStoreFrontCustomerMilestone", () => {
  it("records loyalty milestones against the shared customer profile for registered users", async () => {
    const { ctx, insertedEvents } = createMutationCtx({
      store: { _id: "store_1", organizationId: "org_1" },
      storeFrontProfile: { _id: "customer_storefront_1" },
      storeFrontUser: { _id: "storefront_1" },
    });

    await recordStoreFrontCustomerMilestone(ctx, {
      eventType: "loyalty_points_awarded",
      metadata: { points: 120 },
      storeFrontUserId: "storefront_1" as any,
      storeId: "store_1" as any,
      subjectId: "reward_txn_1",
      subjectLabel: "120 points",
      subjectType: "loyalty",
    });

    expect(insertedEvents[0]).toMatchObject({
      customerProfileId: "customer_storefront_1",
      eventType: "loyalty_points_awarded",
      metadata: { points: 120 },
      organizationId: "org_1",
      storeId: "store_1",
      subjectId: "reward_txn_1",
      subjectLabel: "120 points",
      subjectType: "loyalty",
    });
  });

  it("records follow-up milestones against guest-linked customer profiles", async () => {
    const { ctx, insertedEvents } = createMutationCtx({
      guest: { _id: "guest_1" },
      guestProfile: { _id: "customer_guest_1" },
      store: { _id: "store_1", organizationId: "org_1" },
    });

    await recordStoreFrontCustomerMilestone(ctx, {
      eventType: "follow_up_offer_sent",
      metadata: { promoCode: "WELCOME25" },
      storeFrontUserId: "guest_1" as any,
      storeId: "store_1" as any,
      subjectId: "offer_1",
      subjectLabel: "WELCOME25",
      subjectType: "follow_up",
    });

    expect(insertedEvents[0]).toMatchObject({
      customerProfileId: "customer_guest_1",
      eventType: "follow_up_offer_sent",
      metadata: { promoCode: "WELCOME25" },
      organizationId: "org_1",
      storeId: "store_1",
      subjectId: "offer_1",
      subjectLabel: "WELCOME25",
      subjectType: "follow_up",
    });
  });
});
