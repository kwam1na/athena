import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaginationPersistence } from "./use-pagination-persistence";

describe("usePaginationPersistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not persist page index when the page is controlled externally", async () => {
    const onPageIndexChange = vi.fn();
    const setItemSpy = vi.spyOn(localStorage, "setItem");

    const { result } = renderHook(() =>
      usePaginationPersistence({
        controlledPageIndex: 2,
        onPageIndexChange,
        tableId: "url-controlled-table",
      }),
    );

    expect(result.current.pagination.pageIndex).toBe(2);

    act(() => {
      result.current.setPagination((current) => ({
        ...current,
        pageIndex: 3,
        pageSize: 25,
      }));
    });

    await waitFor(() => {
      expect(onPageIndexChange).toHaveBeenCalledWith(3);
    });

    expect(setItemSpy).not.toHaveBeenCalledWith(
      "url-controlled-table-page-index",
      expect.any(String),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      "url-controlled-table-page-size",
      "25",
    );
  });
});
