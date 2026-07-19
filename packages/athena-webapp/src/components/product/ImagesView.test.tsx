import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImagesView } from "./ImagesView";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  open: vi.fn(),
  sharedDemoContext: null as null | { storeId: string },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

vi.mock("~/src/contexts/ProductContext", () => ({
  useProduct: () => ({
    activeProduct: {
      _id: "product-1",
      availability: "live",
    },
    activeProductVariant: {
      images: [],
      quantityAvailable: 8,
      sku: "SKU-1",
      stock: 8,
    },
  }),
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasFullAdminAccess: true }),
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemoContext,
}));

vi.mock("~/src/config", () => ({
  default: { storeFrontUrl: "https://store.example" },
}));

vi.mock("../View", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("ImagesView demo actions", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.open.mockReset();
    mocks.sharedDemoContext = null;
    vi.stubGlobal("open", mocks.open);
  });

  it("hides product actions and disables their shortcuts in the shared demo", () => {
    mocks.sharedDemoContext = { storeId: "demo-store" };

    render(<ImagesView />);

    expect(screen.queryByRole("button", { name: "Edit product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View on store" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "v" });

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("keeps product actions available outside the shared demo", () => {
    render(<ImagesView />);

    expect(screen.getByRole("button", { name: "Edit product" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View on store" })).toBeInTheDocument();
  });
});
