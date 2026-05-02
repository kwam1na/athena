import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGetStore } from "./useGetStore";
import { useQueryEnabled } from "./useQueryEnabled";

vi.mock("./useGetStore", () => ({
  useGetStore: vi.fn(),
}));

const mockedUseGetStore = vi.mocked(useGetStore);

describe("useQueryEnabled", () => {
  beforeEach(() => {
    mockedUseGetStore.mockReset();
    localStorage.clear();
  });

  it("does not trust persisted store ids before the storefront bootstrap query resolves", () => {
    localStorage.setItem("storeId", "store-from-another-origin");
    localStorage.setItem("organizationId", "org-from-another-origin");
    mockedUseGetStore.mockReturnValue({ data: undefined } as ReturnType<typeof useGetStore>);

    const { result } = renderHook(() => useQueryEnabled());

    expect(result.current).toBe(false);
    expect(mockedUseGetStore).toHaveBeenCalledWith({
      enabled: true,
      asNewUser: false,
    });
  });

  it("enables dependent queries after the storefront bootstrap has resolved", () => {
    mockedUseGetStore.mockReturnValue({
      data: {
        _id: "store-1",
        organizationId: "org-1",
      },
    } as ReturnType<typeof useGetStore>);

    const { result } = renderHook(() => useQueryEnabled());

    expect(result.current).toBe(true);
  });
});
