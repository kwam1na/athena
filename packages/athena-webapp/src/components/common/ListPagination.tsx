import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "../ui/button";

type SharedListPaginationProps = {
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

type NumberedListPaginationProps = SharedListPaginationProps & {
  mode?: "numbered";
  pageCount: number;
  totalItems: number;
};

type CursorListPaginationProps = SharedListPaginationProps & {
  mode: "cursor";
  currentItems: number;
  hasNextPage: boolean;
};

type ListPaginationProps =
  NumberedListPaginationProps | CursorListPaginationProps;

export function ListPagination(props: ListPaginationProps) {
  const { page, pageSize, onPageChange } = props;
  const isCursorPagination = props.mode === "cursor";
  const currentItems = isCursorPagination
    ? props.currentItems
    : Math.min(pageSize, Math.max(0, props.totalItems - (page - 1) * pageSize));
  const visibleStart = currentItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = currentItems === 0 ? 0 : visibleStart + currentItems - 1;
  const canPreviousPage = page > 1;
  const canNextPage = isCursorPagination
    ? props.hasNextPage
    : page < props.pageCount;

  return (
    <div className="flex border-t border-border/70 px-layout-md py-layout-sm text-sm">
      <div className="ml-auto flex flex-col gap-layout-sm sm:flex-row sm:items-center sm:gap-layout-md">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-muted-foreground">
            Showing {visibleStart}-{visibleEnd}
            {isCursorPagination ? null : ` of ${props.totalItems}`}
          </span>
          <span className="text-muted-foreground">
            Page {page}
            {isCursorPagination ? null : ` of ${props.pageCount}`}
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
          {isCursorPagination ? null : (
            <Button
              className="hidden h-8 w-8 p-0 lg:flex"
              disabled={!canNextPage}
              onClick={() => onPageChange(props.pageCount)}
              variant="outline"
            >
              <span className="sr-only">Go to last page</span>
              <ChevronsRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
