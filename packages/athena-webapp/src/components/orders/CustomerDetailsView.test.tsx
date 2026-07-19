import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerDetailsView } from "./CustomerDetailsView";

const mocks = vi.hoisted(() => ({
  order: {
    customerDetails: {
      email: "customer@osustudio.com",
      firstName: "Demo",
      lastName: "Customer",
      phoneNumber: "0000000000",
    },
    storeFrontUserId: "customer-1",
  },
  sharedDemo: null as null | { storeId: string },
}));

vi.mock("~/src/contexts/OnlineOrderContext", () => ({
  useOnlineOrder: () => ({ order: mocks.order }),
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemo,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/customer">{children}</a>
  ),
}));

describe("CustomerDetailsView", () => {
  beforeEach(() => {
    mocks.sharedDemo = null;
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  it("renders the customer identity without linking to the user view in the demo", () => {
    mocks.sharedDemo = { storeId: "store-1" };

    render(<CustomerDetailsView />);

    expect(screen.getByText("Demo Customer").closest("a")).toBeNull();
  });

  it("keeps customer navigation available outside the demo", () => {
    render(<CustomerDetailsView />);

    expect(screen.getByRole("link", { name: "Demo Customer" })).toBeVisible();
  });
});
