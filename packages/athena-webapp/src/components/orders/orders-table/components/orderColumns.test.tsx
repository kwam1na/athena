import { render, screen } from "@testing-library/react";
import type { Row } from "@tanstack/react-table";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OnlineOrder } from "~/types";
import { OrderCustomerCell } from "./OrderCustomerCell";

const mocks = vi.hoisted(() => ({
  sharedDemo: null as null | { storeId: string },
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemo,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
    to: string;
  }) => <a href={to}>{children}</a>,
}));

const row = {
  getValue: () => ({ email: "customer@osustudio.com" }),
  original: { storeFrontUserId: "user-1" },
} as unknown as Row<OnlineOrder>;

describe("OrderCustomerCell", () => {
  beforeEach(() => {
    mocks.sharedDemo = null;
    window.history.replaceState({}, "", "/org/store/store/orders/ready");
  });

  it("renders customer identity without a user-view link in the demo", () => {
    mocks.sharedDemo = { storeId: "store-1" };

    render(<OrderCustomerCell row={row} />);

    expect(screen.getByText("customer@osustudio.com").closest("a")).toBeNull();
  });

  it("keeps customer navigation available outside the demo", () => {
    render(<OrderCustomerCell row={row} />);

    expect(
      screen.getByRole("link", { name: "customer@osustudio.com" }),
    ).toBeVisible();
  });
});
