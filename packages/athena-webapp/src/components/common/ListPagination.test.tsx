import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ListPagination } from "./ListPagination";

describe("ListPagination", () => {
  it("renders truthful cursor pagination without inventing a total", async () => {
    const onPageChange = vi.fn();

    render(
      <ListPagination
        currentItems={10}
        hasNextPage
        mode="cursor"
        onPageChange={onPageChange}
        page={2}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Showing 11-20")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.queryByText(/\sof\s/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Go to last page" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Go to previous page" }),
    );
    expect(onPageChange).toHaveBeenCalledWith(1);

    await userEvent.click(
      screen.getByRole("button", { name: "Go to next page" }),
    );
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
