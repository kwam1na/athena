import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Link } from "@tanstack/react-router";
import { DataTableViewOptions } from "./data-table-view-options";
// import { DataTableViewOptions } from "./data-table-view-options";

// import { priorities, statuses } from "./data/data";
// import { DataTableFacetedFilter } from "./data-table-faceted-filter";

import { X } from "lucide-react";

import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { deliveryMethods, statuses } from "./data";
import { useOrdersTableToolbar } from "./data-table-toolbar-provider";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  return (
    <div className="flex items-center justify-between">
      {/* <div className="flex flex-1 items-center space-x-2">
        <Input
          placeholder="Filter promo codes..."
          value={
            (table.getColumn("orderNumber")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("orderNumber")?.setFilterValue(event.target.value)
          }
          className="h-8 w-[150px] lg:w-[250px]"
        />
      </div> */}

      <div className="ml-auto">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes/new"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
          })}
          className="pr-2"
        >
          <Button variant="ghost" className="h-8 px-2 lg:px-3 ">
            <PlusIcon className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
