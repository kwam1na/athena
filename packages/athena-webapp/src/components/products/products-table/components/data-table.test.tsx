import { fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "./data-table";

vi.mock("./add-product-command", () => ({
  AddProductCommand: () => null,
}));

vi.mock("./data-table-pagination", () => ({
  DataTablePagination: () => null,
}));

type TestProduct = {
  id: string;
  name: string;
};

const products: TestProduct[] = [{ id: "product-1", name: "Batik Tote Bag" }];

const columns: ColumnDef<TestProduct>[] = [
  {
    accessorKey: "name",
    header: "Product",
    cell: ({ row }) => (
      <div>
        <span>{row.original.name}</span>
        <button type="button">Row action</button>
      </div>
    ),
  },
];

describe("product DataTable row navigation", () => {
  it("activates the row with a pointer or Enter key", () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={products}
        onRowClick={onRowClick}
        showToolbar={false}
      />,
    );

    const row = screen.getByRole("link", { name: /Batik Tote Bag/i });

    fireEvent.click(screen.getByText("Batik Tote Bag"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]?.[0].original).toEqual(products[0]);

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("leaves nested interactive controls in charge of their own click", () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={products}
        onRowClick={onRowClick}
        showToolbar={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Row action" }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
