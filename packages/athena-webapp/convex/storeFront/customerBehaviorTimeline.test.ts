import { describe, expect, it } from "vitest";

import { resolveCustomerProfileIdForTimeline } from "./customerBehaviorTimeline";

function createQueryCtx({
  guest,
  guestProfile,
  storeFrontProfile,
  storeFrontUser,
}: {
  guest?: { _id: string } | null;
  guestProfile?: { _id: string } | null;
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

        return null;
      },
      query(table: string) {
        expect(table).toBe("customerProfile");

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
