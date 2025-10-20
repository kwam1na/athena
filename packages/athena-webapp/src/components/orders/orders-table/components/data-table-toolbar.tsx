import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
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

  const {
    selectedDeliveryMethods,
    setSelectedStatuses,
    setSelectedDeliveryMethods,
  } = useOrdersTableToolbar();

  const handleClearFilters = () => {
    const ids = table.getState().columnFilters.map((filter) => filter.id);

    for (const id of ids) {
      localStorage.removeItem(`filters-${id}`);
    }

    setSelectedStatuses(new Set());
    setSelectedDeliveryMethods(new Set());

    table.resetColumnFilters();
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center space-x-2">
        <Input
          placeholder="Filter orders..."
          value={
            (table.getColumn("orderNumber")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("orderNumber")?.setFilterValue(event.target.value)
          }
          className="h-8 w-[150px] lg:w-[250px]"
        />
        {/* {table.getColumn("status") && (
          <DataTableFacetedFilter
            column={table.getColumn("status")}
            title="Status"
            options={statuses}
            selectedValues={selectedStatuses}
            setSelectedValues={setSelectedStatuses}
            table={table}
          />
        )} */}
        {table.getColumn("deliveryMethod") && (
          <DataTableFacetedFilter
            column={table.getColumn("deliveryMethod")}
            title="Delivery method"
            options={deliveryMethods}
            selectedValues={selectedDeliveryMethods}
            setSelectedValues={setSelectedDeliveryMethods}
            table={table}
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={handleClearFilters}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <X className="w-3 h-3 ml-2" />
          </Button>
        )}
      </div>
    </div>
  );
}
