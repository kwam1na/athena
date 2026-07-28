import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryImportRoute } from "./-inventory-import-route";

const mocked = vi.hoisted(() => ({
  pathname: "/wigclub/store/wigclub/operations/inventory-import",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => <div>Nested inventory import route</div>,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => string;
  }) => select({ location: { pathname: mocked.pathname } }),
}));

vi.mock("~/src/components/operations/InventoryImportView", () => ({
  InventoryImportView: ({ mode }: { mode: string }) => (
    <div>Inventory import {mode}</div>
  ),
}));

describe("InventoryImportRoute", () => {
  beforeEach(() => {
    mocked.pathname = "/wigclub/store/wigclub/operations/inventory-import";
  });

  it("renders the import workspace at the route index", () => {
    render(<InventoryImportRoute />);

    expect(screen.getByText("Inventory import import")).toBeInTheDocument();
    expect(
      screen.queryByText("Nested inventory import route"),
    ).not.toBeInTheDocument();
  });

  it.each(["review", "cost-overlay"])(
    "renders the nested %s route through its outlet",
    (childPath) => {
      mocked.pathname = `/wigclub/store/wigclub/operations/inventory-import/${childPath}`;

      render(<InventoryImportRoute />);

      expect(
        screen.getByText("Nested inventory import route"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Inventory import import"),
      ).not.toBeInTheDocument();
    },
  );
});
