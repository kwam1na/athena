import { useState, useEffect } from "react";
import { PaginationState } from "@tanstack/react-table";

interface UsePaginationPersistenceOptions {
  tableId: string;
  defaultPageSize?: number;
}

export function usePaginationPersistence({
  tableId,
  defaultPageSize = 10,
}: UsePaginationPersistenceOptions) {
  // Generate unique localStorage keys for this table instance
  const pageIndexKey = `${tableId}-page-index`;
  const pageSizeKey = `${tableId}-page-size`;

  // Initialize pagination state from localStorage
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: Number(localStorage.getItem(pageIndexKey) ?? 0),
    pageSize: Number(localStorage.getItem(pageSizeKey) ?? defaultPageSize),
  }));

  // Persist pagination changes to localStorage
  useEffect(() => {
    localStorage.setItem(pageIndexKey, pagination.pageIndex.toString());
    localStorage.setItem(pageSizeKey, pagination.pageSize.toString());
  }, [pagination, pageIndexKey, pageSizeKey]);

  return { pagination, setPagination };
}
