import { PlusIcon } from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "../../ui/button";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
}

export function DataTableToolbar<TData>({
  table,
}: DataTableToolbarProps<TData>) {
  return (
    <div className="flex items-center justify-between">
      <div className="ml-auto">
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes/new"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
          })}
          search={{ o: getOrigin() }}
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
