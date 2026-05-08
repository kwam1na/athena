import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "../ui/button";

type ListPaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
};

export function ListPagination({
  page,
  pageCount,
  pageSize,
  totalItems,
  onPageChange,
}: ListPaginationProps) {
  const visibleStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(page * pageSize, totalItems);
  const canPreviousPage = page > 1;
  const canNextPage = page < pageCount;

  return (
    <div className="flex border-t border-border/70 px-layout-md py-layout-sm text-sm">
      <div className="ml-auto flex flex-col gap-layout-sm sm:flex-row sm:items-center sm:gap-layout-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-muted-foreground">
            Showing {visibleStart}-{visibleEnd} of {totalItems}
          </span>
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            className="hidden h-8 w-8 p-0 lg:flex"
            disabled={!canPreviousPage}
            onClick={() => onPageChange(1)}
            variant="outline"
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeft />
          </Button>
          <Button
            className="h-8 w-8 p-0"
            disabled={!canPreviousPage}
            onClick={() => onPageChange(page - 1)}
            variant="outline"
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeft />
          </Button>
          <Button
            className="h-8 w-8 p-0"
            disabled={!canNextPage}
            onClick={() => onPageChange(page + 1)}
            variant="outline"
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRight />
          </Button>
          <Button
            className="hidden h-8 w-8 p-0 lg:flex"
            disabled={!canNextPage}
            onClick={() => onPageChange(pageCount)}
            variant="outline"
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
