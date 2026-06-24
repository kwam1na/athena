import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OrganizationView from "./OrganizationView";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useGetStores: vi.fn(),
  usePermissions: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ orgUrlSlug: "wigclub" }),
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

describe("OrganizationView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.useGetStores.mockReturnValue([{ slug: "main" }]);
    mocks.usePermissions.mockReturnValue({
      isLoading: false,
      role: "full_admin",
    });
  });

  it("routes POS-only users from the organization entry to the POS hub", async () => {
    mocks.usePermissions.mockReturnValue({
      isLoading: false,
      role: "pos_only",
    });

    render(<OrganizationView />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos",
        params: expect.any(Function),
      }),
    );
    const params = mocks.navigate.mock.calls[0]?.[0].params({});
    expect(params).toEqual({
      orgUrlSlug: "wigclub",
      storeUrlSlug: "main",
    });
  });

  it("routes full-admin users from the organization entry to daily operations", async () => {
    render(<OrganizationView />);

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations",
        params: expect.any(Function),
      }),
    );
  });

  it("waits for permission state before choosing an entry route", () => {
    mocks.usePermissions.mockReturnValue({
      isLoading: true,
      role: null,
    });

    render(<OrganizationView />);

    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
