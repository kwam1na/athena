import { useState, useEffect, useRef } from "react";
import { PaginationState } from "@tanstack/react-table";

interface UsePaginationPersistenceOptions {
  controlledPageIndex?: number;
  defaultPageSize?: number;
  onPageIndexChange?: (pageIndex: number) => void;
  tableId: string;
}

export function usePaginationPersistence({
  controlledPageIndex,
  defaultPageSize = 10,
  onPageIndexChange,
  tableId,
}: UsePaginationPersistenceOptions) {
  // Generate unique localStorage keys for this table instance
  const pageIndexKey = `${tableId}-page-index`;
  const pageSizeKey = `${tableId}-page-size`;

  // Initialize pagination state from localStorage
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex:
      controlledPageIndex ?? Number(localStorage.getItem(pageIndexKey) ?? 0),
    pageSize: Number(localStorage.getItem(pageSizeKey) ?? defaultPageSize),
  }));
  const lastNotifiedPageIndexRef = useRef(pagination.pageIndex);
  const lastControlledPageIndexRef = useRef(controlledPageIndex);

  useEffect(() => {
    if (
      controlledPageIndex === undefined ||
      controlledPageIndex === lastControlledPageIndexRef.current
    ) {
      return;
    }

    lastControlledPageIndexRef.current = controlledPageIndex;

    if (controlledPageIndex === pagination.pageIndex) {
      return;
    }

    setPagination((current) => ({
      ...current,
      pageIndex: controlledPageIndex,
    }));
  }, [controlledPageIndex, pagination.pageIndex]);

  // Persist pagination changes to localStorage
  useEffect(() => {
    localStorage.setItem(pageIndexKey, pagination.pageIndex.toString());
    localStorage.setItem(pageSizeKey, pagination.pageSize.toString());

    if (lastNotifiedPageIndexRef.current !== pagination.pageIndex) {
      lastNotifiedPageIndexRef.current = pagination.pageIndex;
      onPageIndexChange?.(pagination.pageIndex);
    }
  }, [onPageIndexChange, pagination, pageIndexKey, pageSizeKey]);

  return { pagination, setPagination };
}
