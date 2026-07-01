import { render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { beforeEach, describe, expect, it } from "vitest";

import { GenericDataTable } from "./data-table";

type TestRow = {
  id: string;
  name: string;
};

const columns: ColumnDef<TestRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => row.original.name,
  },
];

describe("GenericDataTable", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders mobile cards from the paginated row model", () => {
    const data = Array.from({ length: 12 }, (_, index) => ({
      id: `row-${index + 1}`,
      name: `Item ${index + 1}`,
    }));

    render(
      <GenericDataTable
        columns={columns}
        data={data}
        pageIndex={1}
        renderMobileCard={(row) => <article>{row.name}</article>}
        tableId="shared-mobile-pagination"
      />,
    );

    const mobileCards = screen.getByTestId(
      "shared-mobile-pagination-mobile-cards",
    );

    expect(within(mobileCards).queryByText("Item 1")).not.toBeInTheDocument();
    expect(within(mobileCards).getByText("Item 11")).toBeInTheDocument();
    expect(within(mobileCards).getByText("Item 12")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});
