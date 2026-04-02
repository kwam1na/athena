import { useEffect } from "react";
import { Table } from "@tanstack/react-table";

const INTERACTIVE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useTableKeyboardPagination<TData>(table: Table<TData>) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el &&
        (INTERACTIVE_TAGS.has(el.tagName) ||
          (el as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === "ArrowLeft" && table.getCanPreviousPage()) {
        e.preventDefault();
        table.previousPage();
      } else if (e.key === "ArrowRight" && table.getCanNextPage()) {
        e.preventDefault();
        table.nextPage();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [table]);
}
