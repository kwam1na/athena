import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";

const { getActiveUser, getStoreDetails } = vi.hoisted(() => ({
  getActiveUser: vi.fn(),
  getStoreDetails: vi.fn(),
}));

vi.mock("@/api/storeFrontUser", () => ({
  getActiveUser,
  updateUser: vi.fn(),
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  getStoreDetails,
}));

import { accountBeforeLoad } from "./account";

describe("account route authorization boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    getActiveUser.mockReset();
    getStoreDetails.mockReset();
    getStoreDetails.mockReturnValue({
      storeId: "store_fixture",
      organizationId: "org_fixture",
    });
  });

  it("redirects unauthenticated direct entry before loading account data", async () => {
    await expect(accountBeforeLoad()).rejects.toBeDefined();
    expect(getActiveUser).not.toHaveBeenCalled();
  });

  it("retains the active-user ownership check for authenticated entry", async () => {
    localStorage.setItem(LOGGED_IN_USER_ID_KEY, "user_fixture");
    getActiveUser.mockResolvedValue({ _id: "user_fixture" });
    await expect(accountBeforeLoad()).resolves.toBeUndefined();
    expect(getActiveUser).toHaveBeenCalledOnce();
  });

  it("redirects when the active-user ownership check expires", async () => {
    localStorage.setItem(LOGGED_IN_USER_ID_KEY, "user_fixture");
    getActiveUser.mockRejectedValue(new Error("Expired session"));
    await expect(accountBeforeLoad()).rejects.toBeDefined();
  });
});
