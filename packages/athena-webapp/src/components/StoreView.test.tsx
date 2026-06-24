import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StoreView from "./StoreView";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  onOpenStoreModal: vi.fn(),
  useGetActiveOrganization: vi.fn(),
  useGetStores: vi.fn(),
  usePermissions: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/use-store-modal", () => ({
  useStoreModal: () => ({ onOpen: mocks.onOpenStoreModal }),
}));

vi.mock("@/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: mocks.useGetActiveOrganization,
}));

vi.mock("../hooks/useGetActiveStore", () => ({
  useGetStores: mocks.useGetStores,
}));

vi.mock("../hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

vi.mock("./View", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("StoreView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.onOpenStoreModal.mockReset();
    mocks.useGetActiveOrganization.mockReturnValue({
      activeOrganization: { name: "Wig Club", slug: "wigclub" },
    });
    mocks.useGetStores.mockReturnValue([{ slug: "main" }]);
    mocks.usePermissions.mockReturnValue({
      isLoading: false,
      role: "full_admin",
    });
  });

  it("routes POS-only users to the POS hub for their first store", async () => {
    mocks.usePermissions.mockReturnValue({
      isLoading: false,
      role: "pos_only",
    });

    render(<StoreView />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos",
        params: expect.any(Function),
      }),
    );
    const params = mocks.navigate.mock.calls[0]?.[0].params({
      orgUrlSlug: "wigclub",
    });
    expect(params).toEqual({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "main",
    });
  });

  it("keeps full-admin users on daily operations for their first store", async () => {
    render(<StoreView />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations",
        params: expect.any(Function),
      }),
    );
  });
});
