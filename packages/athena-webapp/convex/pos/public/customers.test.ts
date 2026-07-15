import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  searchCustomers: vi.fn(),
  getCustomerById: vi.fn(),
  getCustomerTransactions: vi.fn(),
  findByStoreFrontUser: vi.fn(),
  findPotentialMatches: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  updateCustomerStats: vi.fn(),
  resolvePosCustomerSelection: vi.fn(),
  linkToStoreFrontUser: vi.fn(),
  linkToGuest: vi.fn(),
  resolveStoreFrontUserMatch: vi.fn(),
  resolveGuestMatch: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/queries/searchCustomers", () => ({
  searchCustomers: mocks.searchCustomers,
  getCustomerById: mocks.getCustomerById,
  getCustomerTransactions: mocks.getCustomerTransactions,
  findByStoreFrontUser: mocks.findByStoreFrontUser,
  findPotentialMatches: mocks.findPotentialMatches,
}));

vi.mock("../application/commands/assignCustomer", () => ({
  createCustomer: mocks.createCustomer,
  updateCustomer: mocks.updateCustomer,
  updateCustomerStats: mocks.updateCustomerStats,
  resolvePosCustomerSelection: mocks.resolvePosCustomerSelection,
  linkToStoreFrontUser: mocks.linkToStoreFrontUser,
  linkToGuest: mocks.linkToGuest,
  resolveStoreFrontUserMatch: mocks.resolveStoreFrontUserMatch,
  resolveGuestMatch: mocks.resolveGuestMatch,
}));

import {
  createCustomer,
  getCustomerById,
  getCustomerTransactions,
  findByStoreFrontUser,
  searchCustomers,
  updateCustomer,
} from "./customers";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

function buildCtx(
  overrides: {
    store?: Record<string, unknown> | null;
    posCustomer?: Record<string, unknown> | null;
    storeFrontUser?: Record<string, unknown> | null;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "store")
            ? overrides.store
            : { _id: "store-1", organizationId: "org-1" };
        }
        if (tableName === "posCustomer" && id === "customer-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "posCustomer")
            ? overrides.posCustomer
            : { _id: "customer-1", storeId: "store-1", name: "Ada" };
        }
        if (tableName === "storeFrontUser" && id === "sf-user-1") {
          return Object.prototype.hasOwnProperty.call(
            overrides,
            "storeFrontUser",
          )
            ? overrides.storeFrontUser
            : { _id: "sf-user-1", storeId: "store-1" };
        }
        return null;
      }),
    },
  };
}

describe("pos public customers authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "pos_only",
    });
    mocks.searchCustomers.mockResolvedValue([{ _id: "customer-1" }]);
    mocks.getCustomerById.mockResolvedValue({ _id: "customer-1", name: "Ada" });
    mocks.createCustomer.mockResolvedValue({ kind: "ok", data: {} });
    mocks.updateCustomer.mockResolvedValue({ kind: "ok", data: null });
    mocks.findByStoreFrontUser.mockResolvedValue({ _id: "customer-1" });
  });

  it("searches customers for a same-org member", async () => {
    const ctx = buildCtx();

    const result = await getHandler(searchCustomers)(ctx as never, {
      storeId: "store-1",
      searchQuery: "ada",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.searchCustomers).toHaveBeenCalled();
    expect(result).toEqual([{ _id: "customer-1" }]);
  });

  it("denies a foreign-org user searching another store's customers (PII leak)", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot search customers for this store."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(searchCustomers)(ctx as never, {
        storeId: "store-1",
        searchQuery: "ada",
      }),
    ).rejects.toThrow("You cannot search customers for this store.");
    expect(mocks.searchCustomers).not.toHaveBeenCalled();
  });

  it("denies a foreign-org user reading a customer by id even with a valid id", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot view this customer."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(getCustomerById)(ctx as never, { customerId: "customer-1" }),
    ).rejects.toThrow("You cannot view this customer.");
    expect(mocks.getCustomerById).not.toHaveBeenCalled();
  });

  it("scopes getCustomerById to the customer's store organization", async () => {
    const ctx = buildCtx();

    await getHandler(getCustomerById)(ctx as never, {
      customerId: "customer-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ organizationId: "org-1" }),
    );
    expect(mocks.getCustomerById).toHaveBeenCalled();
  });

  it("returns null without leaking PII for a non-existent customer", async () => {
    const ctx = buildCtx({ posCustomer: null });

    const result = await getHandler(getCustomerById)(ctx as never, {
      customerId: "customer-1",
    });

    expect(result).toBeNull();
    expect(mocks.requireAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
    expect(mocks.getCustomerById).not.toHaveBeenCalled();
  });

  it("denies a foreign-org user creating a customer for another store", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot create customers for this store."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(createCustomer)(ctx as never, {
        storeId: "store-1",
        name: "Mallory",
      }),
    ).rejects.toThrow("You cannot create customers for this store.");
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it("denies a foreign-org user updating another store's customer", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot update this customer."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(updateCustomer)(ctx as never, {
        customerId: "customer-1",
        name: "Mallory",
      }),
    ).rejects.toThrow("You cannot update this customer.");
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller creating a customer", async () => {
    mocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("Sign in again to continue."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(createCustomer)(ctx as never, {
        storeId: "store-1",
        name: "Mallory",
      }),
    ).rejects.toThrow("Sign in again to continue.");
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it("scopes findByStoreFrontUser to the storefront user's store org", async () => {
    const ctx = buildCtx();

    await getHandler(findByStoreFrontUser)(ctx as never, {
      storeFrontUserId: "sf-user-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ organizationId: "org-1" }),
    );
    expect(mocks.findByStoreFrontUser).toHaveBeenCalled();
  });

  it("denies getCustomerTransactions across org boundaries", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("You cannot view this customer."),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(getCustomerTransactions)(ctx as never, {
        customerId: "customer-1",
      }),
    ).rejects.toThrow("You cannot view this customer.");
    expect(mocks.getCustomerTransactions).not.toHaveBeenCalled();
  });
});
