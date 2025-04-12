import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { Link } from "@tanstack/react-router";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { useGetSubcategories } from "~/src/hooks/useGetSubcategories";
import { getOrigin } from "~/src/lib/navigationUtils";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0;

  const subcategories = useGetSubcategories();

  const subcategoryOptions = subcategories
    ?.map((s) => ({
      label: s.name,
      value: s._id,
    }))
    ?.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center justify-between space-x-2">
        <div className="flex gap-2">
          <Input
            placeholder="Filter products..."
            value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("name")?.setFilterValue(event.target.value)
            }
            className="h-8 w-[150px] lg:w-[250px]"
          />
          {table.getColumn("subcategoryId") && (
            <DataTableFacetedFilter
              column={table.getColumn("subcategoryId")}
              title="Subcategory"
              options={subcategoryOptions || []}
            />
          )}

          {isFiltered && (
            <Button
              variant="ghost"
              onClick={() => table.resetColumnFilters()}
              className="h-8 px-2 lg:px-3"
            >
              Reset
              <Cross2Icon className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>

        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/products/new"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
          })}
          search={{
            o: getOrigin(),
          }}
          className="pr-2"
        >
          <Button variant="ghost" className="h-8 px-2 lg:px-3 ">
            <PlusIcon className="h-4 w-4 mr-2" />
            New product
          </Button>
        </Link>
      </div>
      {/* <DataTableViewOptions table={table} /> */}
    </div>
  );
}
