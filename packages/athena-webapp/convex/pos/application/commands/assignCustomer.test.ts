import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  createCustomer,
  resolveGuestMatch,
  resolvePosCustomerSelection,
  resolveStoreFrontUserMatch,
} from "./assignCustomer";
import {
  createPosCustomer,
  ensureCustomerProfileFromSources,
  findCustomerByEmail,
  findCustomerByPhone,
  findPosCustomerByGuest,
  findPosCustomerByStoreFrontUser,
  getGuestById,
  getPosCustomerById,
  getStoreFrontUserById,
  patchPosCustomer,
} from "../../infrastructure/repositories/customerRepository";

vi.mock("../../infrastructure/repositories/customerRepository", () => ({
  createPosCustomer: vi.fn(),
  ensureCustomerProfileFromSources: vi.fn(),
  findCustomerByEmail: vi.fn(),
  findCustomerByPhone: vi.fn(),
  findPosCustomerByGuest: vi.fn(),
  findPosCustomerByStoreFrontUser: vi.fn(),
  getGuestById: vi.fn(),
  getPosCustomerById: vi.fn(),
  getStoreFrontUserById: vi.fn(),
  patchPosCustomer: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POS customer attribution commands", () => {
  it("resolves a selected POS customer to its reusable customer profile", async () => {
    vi.mocked(getPosCustomerById).mockResolvedValue(posCustomer() as never);
    vi.mocked(ensureCustomerProfileFromSources).mockResolvedValue(
      customerProfile() as never,
    );

    const result = await resolvePosCustomerSelection({} as never, {
      customerId: "pos-customer-1" as Id<"posCustomer">,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "pos-customer-1",
        customerProfileId: "customer-profile-1",
        attribution: {
          kind: "pos_customer",
          posCustomerId: "pos-customer-1",
          customerProfileId: "customer-profile-1",
          reusable: true,
        },
      },
    });
    expect(ensureCustomerProfileFromSources).toHaveBeenCalledWith(
      expect.anything(),
      {
        posCustomerId: "pos-customer-1",
        fallbackStoreId: "store-1",
      },
    );
  });

  it("resolves an existing POS customer by email and returns its customer profile", async () => {
    vi.mocked(findCustomerByEmail).mockResolvedValue(posCustomer() as never);
    vi.mocked(findCustomerByPhone).mockResolvedValue(null as never);
    vi.mocked(ensureCustomerProfileFromSources).mockResolvedValue(
      customerProfile() as never,
    );

    const result = await createCustomer({} as never, {
      storeId: "store-1" as Id<"store">,
      name: "Ama Serwa",
      email: "ama@example.com",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "pos-customer-1",
        customerProfileId: "customer-profile-1",
        attribution: {
          kind: "pos_customer",
          posCustomerId: "pos-customer-1",
          customerProfileId: "customer-profile-1",
          reusable: true,
        },
      },
    });
    expect(createPosCustomer).not.toHaveBeenCalled();
    expect(ensureCustomerProfileFromSources).toHaveBeenCalledWith(
      expect.anything(),
      {
        posCustomerId: "pos-customer-1",
        fallbackStoreId: "store-1",
      },
    );
  });

  it("returns a conflict command result when email and phone resolve different POS customers", async () => {
    vi.mocked(findCustomerByEmail).mockResolvedValue(posCustomer() as never);
    vi.mocked(findCustomerByPhone).mockResolvedValue(
      posCustomer({ _id: "pos-customer-2" as Id<"posCustomer"> }) as never,
    );

    const result = await createCustomer({} as never, {
      storeId: "store-1" as Id<"store">,
      name: "Ama Serwa",
      email: "ama@example.com",
      phone: "233555000111",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "conflict",
        message:
          "Email and phone match different POS customers. Select a customer before continuing.",
      },
    });
    expect(createPosCustomer).not.toHaveBeenCalled();
  });

  it("keeps name-only customer attribution sale-only without creating a POS customer or profile", async () => {
    const result = await createCustomer({} as never, {
      storeId: "store-1" as Id<"store">,
      name: "Walk-in Shopper",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        name: "Walk-in Shopper",
        attribution: {
          kind: "sale_only",
          reusable: false,
        },
      },
    });
    expect(result.kind === "ok" ? result.data._id : null).toBeUndefined();
    expect(createPosCustomer).not.toHaveBeenCalled();
    expect(ensureCustomerProfileFromSources).not.toHaveBeenCalled();
  });

  it("creates a POS source for a selected storefront match and links the shared profile", async () => {
    vi.mocked(getStoreFrontUserById).mockResolvedValue(
      storeFrontUser() as never,
    );
    vi.mocked(findPosCustomerByStoreFrontUser).mockResolvedValue(null as never);
    vi.mocked(findCustomerByEmail).mockResolvedValue(null as never);
    vi.mocked(findCustomerByPhone).mockResolvedValue(null as never);
    vi.mocked(createPosCustomer).mockResolvedValue(
      "pos-customer-1" as Id<"posCustomer"> as never,
    );
    vi.mocked(getPosCustomerById).mockResolvedValue(posCustomer() as never);
    vi.mocked(ensureCustomerProfileFromSources).mockResolvedValue(
      customerProfile({
        storeFrontUserId: "storefront-user-1" as Id<"storeFrontUser">,
      }) as never,
    );

    const result = await resolveStoreFrontUserMatch({} as never, {
      storeId: "store-1" as Id<"store">,
      storeFrontUserId: "storefront-user-1" as Id<"storeFrontUser">,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "pos-customer-1",
        customerProfileId: "customer-profile-1",
        attribution: {
          kind: "storefront_user",
          posCustomerId: "pos-customer-1",
          storeFrontUserId: "storefront-user-1",
          customerProfileId: "customer-profile-1",
          reusable: true,
        },
      },
    });
    expect(createPosCustomer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        linkedStoreFrontUserId: "storefront-user-1",
        email: "ama@example.com",
      }),
    );
  });

  it("reuses a POS source for a selected guest match and links the shared profile", async () => {
    vi.mocked(getGuestById).mockResolvedValue(guest() as never);
    vi.mocked(findPosCustomerByGuest).mockResolvedValue(null as never);
    vi.mocked(findCustomerByEmail).mockResolvedValue(posCustomer() as never);
    vi.mocked(findCustomerByPhone).mockResolvedValue(null as never);
    vi.mocked(ensureCustomerProfileFromSources).mockResolvedValue(
      customerProfile({ guestId: "guest-1" as Id<"guest"> }) as never,
    );

    const result = await resolveGuestMatch({} as never, {
      storeId: "store-1" as Id<"store">,
      guestId: "guest-1" as Id<"guest">,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        _id: "pos-customer-1",
        customerProfileId: "customer-profile-1",
        attribution: {
          kind: "guest",
          posCustomerId: "pos-customer-1",
          guestId: "guest-1",
          customerProfileId: "customer-profile-1",
          reusable: true,
        },
      },
    });
    expect(patchPosCustomer).toHaveBeenCalledWith(
      expect.anything(),
      "pos-customer-1",
      expect.objectContaining({
        linkedGuestId: "guest-1",
        email: "ama@example.com",
      }),
    );
    expect(createPosCustomer).not.toHaveBeenCalled();
  });
});

function posCustomer(overrides = {}) {
  return {
    _id: "pos-customer-1" as Id<"posCustomer">,
    _creationTime: 1,
    storeId: "store-1" as Id<"store">,
    name: "Ama Serwa",
    email: "ama@example.com",
    phone: "233555000111",
    totalSpent: 0,
    transactionCount: 0,
    loyaltyPoints: 0,
    isActive: true,
    ...overrides,
  };
}

function customerProfile(overrides = {}) {
  return {
    _id: "customer-profile-1" as Id<"customerProfile">,
    _creationTime: 1,
    storeId: "store-1" as Id<"store">,
    fullName: "Ama Serwa",
    email: "ama@example.com",
    phoneNumber: "233555000111",
    posCustomerId: "pos-customer-1" as Id<"posCustomer">,
    status: "active",
    ...overrides,
  };
}

function storeFrontUser() {
  return {
    _id: "storefront-user-1" as Id<"storeFrontUser">,
    _creationTime: 1,
    storeId: "store-1" as Id<"store">,
    organizationId: "org-1" as Id<"organization">,
    firstName: "Ama",
    lastName: "Serwa",
    email: "ama@example.com",
    phoneNumber: "233555000111",
  };
}

function guest() {
  return {
    _id: "guest-1" as Id<"guest">,
    _creationTime: 1,
    storeId: "store-1" as Id<"store">,
    organizationId: "org-1" as Id<"organization">,
    firstName: "Ama",
    lastName: "Serwa",
    email: "ama@example.com",
    phoneNumber: "233555000111",
  };
}
