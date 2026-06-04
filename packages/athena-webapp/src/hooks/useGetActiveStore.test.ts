import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import useGetActiveStore from "./useGetActiveStore";

const useQueryMock = vi.fn();
const useParamsMock = vi.fn();
const useGetActiveOrganizationMock = vi.fn();
const getStoresActionMock = vi.fn();

vi.mock("convex/react", () => ({
  useAction: () => getStoresActionMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
}));

vi.mock("./useGetOrganizations", () => ({
  useGetActiveOrganization: () => useGetActiveOrganizationMock(),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      stores: {
        getAll: "inventory.stores.getAll",
        getAllByOrganization: "inventory.stores.getAllByOrganization",
      },
    },
  },
}));

describe("useGetActiveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: { _id: "org-1" },
    });
    useParamsMock.mockReturnValue({ storeUrlSlug: "downtown" });
    useQueryMock.mockReturnValue([
      { _id: "store-1", name: "Warehouse", slug: "warehouse" },
      { _id: "store-2", name: "Downtown", slug: "downtown" },
    ]);
  });

  it("returns the store matching the current route slug from the store query", () => {
    const { result } = renderHook(() => useGetActiveStore());

    expect(result.current.activeStore).toEqual({
      _id: "store-2",
      name: "Downtown",
      slug: "downtown",
    });
    expect(result.current.isLoadingStores).toBe(false);
    expect(getStoresActionMock).not.toHaveBeenCalled();
  });

  it("skips live store reads when the active organization is unavailable", () => {
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: null,
    });
    useQueryMock.mockReturnValue(undefined);

    const { result } = renderHook(() => useGetActiveStore());

    expect(useQueryMock).toHaveBeenCalledWith("inventory.stores.getAll", "skip");
    expect(result.current.activeStore).toBeNull();
    expect(result.current.isLoadingStores).toBe(false);
    expect(getStoresActionMock).not.toHaveBeenCalled();
  });
});
