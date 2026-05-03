import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Button } from "../../ui/button";
import { useEffect } from "react";

const tableHeaderClass =
  "text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  enableControls?: boolean;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  enableControls = false,
  className,
  title,
}: DataTableColumnHeaderProps<TData, TValue>) {
  // Load initial sorting preference from localStorage
  useEffect(() => {
    if (!enableControls) {
      return;
    }

    const savedSort = localStorage.getItem(`table-sort-${title}`);
    if (savedSort) {
      column.toggleSorting(savedSort === "desc", true);
    }
  }, [column, enableControls, title]);

  // Save sorting preference when it changes
  useEffect(() => {
    if (!enableControls) {
      return;
    }

    const currentSort = column.getIsSorted();
    if (currentSort) {
      localStorage.setItem(`table-sort-${title}`, currentSort);
    } else {
      localStorage.removeItem(`table-sort-${title}`);
    }
  }, [column.getIsSorted(), enableControls, title]);

  if (!enableControls || !column.getCanSort()) {
    return (
      <div
        className={cn("flex w-full items-center", tableHeaderClass, className)}
      >
        {title}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "-ml-3 h-8 data-[state=open]:bg-accent",
              tableHeaderClass,
            )}
          >
            <span>{title}</span>
            {column.getIsSorted() === "desc" ? (
              <ArrowDown className="w-3.5 h-3.5 ml-2" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUp className="w-3.5 h-3.5 ml-2" />
            ) : (
              <ChevronsUpDown className="w-3.5 h-3.5 ml-2" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
            <ArrowUp className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
            <ArrowDown className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
            Desc
          </DropdownMenuItem>
          {column.getCanHide() ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
                <EyeOff className="h-3.5 w-3.5 mr-2 text-muted-foreground/70" />
                Hide
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
