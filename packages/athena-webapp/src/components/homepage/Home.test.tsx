import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./Home";

const mocks = vi.hoisted(() => ({
  useGetActiveStore: vi.fn(),
  useQuery: vi.fn(),
  useSharedDemoContext: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("~/src/hooks/useGetActiveStore", () => ({
  default: mocks.useGetActiveStore,
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: mocks.useSharedDemoContext,
}));

vi.mock("./BestSellers", () => ({
  BestSellers: () => <button type="button">Add product</button>,
}));

vi.mock("./FeaturedSection", () => ({
  FeaturedSection: () => <button type="button">Add highlighted item</button>,
}));

vi.mock("./ShopLook", () => ({
  ShopLookSection: () => <button type="button">Add product</button>,
}));

vi.mock("./HeroSectionTabs", () => ({
  HeroSectionTabs: () => <button type="button">Edit hero display</button>,
}));

vi.mock("./BannerMessageEditor", () => ({
  BannerMessageEditor: () => <button type="button">Edit site banner</button>,
}));

describe("Home", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1", name: "Demo Market" },
    });
    mocks.useQuery.mockImplementation((_, args) =>
      args === "skip" ? undefined : [{ _id: "product-1" }],
    );
    mocks.useSharedDemoContext.mockReturnValue(null);
  });

  it("makes homepage settings view-only in the shared demo", () => {
    mocks.useSharedDemoContext.mockReturnValue({ storeId: "store-1" });

    render(<Home />);

    expect(screen.getByText("Homepage is view-only in the demo.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can browse product selections; saving storefront content and media changes is disabled.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("group")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit hero display" })).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: "Add product" })) {
      expect(button).toBeEnabled();
    }
    expect(
      screen.getByRole("button", { name: "Add highlighted item" }),
    ).toBeEnabled();
  });

  it("keeps homepage settings editable outside the shared demo", () => {
    render(<Home />);

    expect(
      screen.queryByText("Homepage is view-only in the demo."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit hero display" }),
    ).toBeEnabled();
  });
});
