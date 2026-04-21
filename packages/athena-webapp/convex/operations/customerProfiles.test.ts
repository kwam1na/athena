import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  buildCustomerProfileDraft,
  findMatchingCustomerProfile,
} from "./helpers/linking";

describe("customer profile linking helpers", () => {
  it("builds a canonical customer draft from storefront and POS sources", () => {
    const draft = buildCustomerProfileDraft({
      storeFrontUser: {
        _id: "storefront_1" as Id<"storeFrontUser">,
        _creationTime: 1,
        email: " Shopper@Example.com ",
        firstName: "Afi",
        lastName: "Mensah",
        phoneNumber: "233555000111",
        storeId: "store_1" as Id<"store">,
        organizationId: "org_1" as Id<"organization">,
      },
      posCustomer: {
        _id: "pos_customer_1" as Id<"posCustomer">,
        _creationTime: 2,
        storeId: "store_1" as Id<"store">,
        name: "Afi Mensah",
        email: "shopper@example.com",
        phone: "233555000111",
      } as any,
    });

    expect(draft).toMatchObject({
      storeId: "store_1",
      organizationId: "org_1",
      fullName: "Afi Mensah",
      email: "shopper@example.com",
      phoneNumber: "233555000111",
      storeFrontUserId: "storefront_1",
      posCustomerId: "pos_customer_1",
      status: "active",
    });
  });

  it("falls back to guest details when storefront and POS sources are absent", () => {
    const draft = buildCustomerProfileDraft({
      guest: {
        _id: "guest_1" as Id<"guest">,
        _creationTime: 1,
        email: "Guest@example.com",
        firstName: "Efua",
        lastName: "Owusu",
        phoneNumber: "233555222333",
        storeId: "store_1" as Id<"store">,
        organizationId: "org_1" as Id<"organization">,
      } as any,
    });

    expect(draft).toMatchObject({
      storeId: "store_1",
      organizationId: "org_1",
      fullName: "Efua Owusu",
      email: "guest@example.com",
      phoneNumber: "233555222333",
      guestId: "guest_1",
    });
  });

  it("prefers direct identity links before falling back to email matches", () => {
    const directMatch = findMatchingCustomerProfile(
      [
        {
          _id: "customer_profile_direct" as Id<"customerProfile">,
          storeId: "store_1" as Id<"store">,
          email: "shopper@example.com",
          phoneNumber: "233555000111",
          storeFrontUserId: "storefront_1" as Id<"storeFrontUser">,
        } as any,
        {
          _id: "customer_profile_email" as Id<"customerProfile">,
          storeId: "store_1" as Id<"store">,
          email: "shopper@example.com",
          phoneNumber: "233555999999",
        } as any,
      ],
      {
        storeId: "store_1" as Id<"store">,
        storeFrontUserId: "storefront_1" as Id<"storeFrontUser">,
        email: "shopper@example.com",
      }
    );

    expect(directMatch?._id).toBe("customer_profile_direct");
  });

  it("keeps email matches store-scoped", () => {
    const match = findMatchingCustomerProfile(
      [
        {
          _id: "customer_profile_other_store" as Id<"customerProfile">,
          storeId: "store_2" as Id<"store">,
          email: "shopper@example.com",
        } as any,
        {
          _id: "customer_profile_local" as Id<"customerProfile">,
          storeId: "store_1" as Id<"store">,
          email: "shopper@example.com",
        } as any,
      ],
      {
        storeId: "store_1" as Id<"store">,
        email: "shopper@example.com",
      }
    );

    expect(match?._id).toBe("customer_profile_local");
  });

  it("matches email lookups even when incoming casing or whitespace differs", () => {
    const match = findMatchingCustomerProfile(
      [
        {
          _id: "customer_profile_normalized" as Id<"customerProfile">,
          storeId: "store_1" as Id<"store">,
          email: "shopper@example.com",
        } as any,
      ],
      {
        storeId: "store_1" as Id<"store">,
        email: " Shopper@Example.com ",
      }
    );

    expect(match?._id).toBe("customer_profile_normalized");
  });
});
