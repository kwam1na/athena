import { render, screen } from "@testing-library/react";
import type { Table } from "@tanstack/react-table";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DataTableToolbar } from "./data-table-toolbar";

const mocks = vi.hoisted(() => ({
  sharedDemoContext: null as null | { kind: "shared_demo" },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#new-product">{children}</a>
  ),
  useSearch: () => ({ categorySlug: "demo-handmade" }),
}));

vi.mock("~/src/hooks/useGetCategories", () => ({
  useGetCategories: () => [],
}));

vi.mock("~/src/hooks/useGetSubcategories", () => ({
  useGetSubcategories: () => [],
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasFullAdminAccess: true }),
}));

vi.mock("~/src/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemoContext,
}));

const table = {
  getColumn: () => undefined,
  getState: () => ({ columnFilters: [] }),
  resetColumnFilters: vi.fn(),
} as unknown as Table<unknown>;

describe("DataTableToolbar", () => {
  beforeEach(() => {
    mocks.sharedDemoContext = null;
  });

  it("hides product creation in the shared demo", () => {
    mocks.sharedDemoContext = { kind: "shared_demo" };

    render(<DataTableToolbar table={table} />);

    expect(
      screen.queryByRole("button", { name: "New product" }),
    ).not.toBeInTheDocument();
  });

  it("keeps product creation available outside the shared demo", () => {
    render(<DataTableToolbar table={table} />);

    expect(screen.getByRole("button", { name: "New product" })).toBeVisible();
  });
});
