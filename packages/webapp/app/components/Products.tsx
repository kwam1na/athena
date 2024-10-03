import { columns } from "./products-table/components/columns";
import { DataTable } from "./products-table/components/data-table";
import { useQuery } from "@tanstack/react-query";
import { getAllProducts } from "@/api/product.ts";
import { ErrorPage } from "./states/error";
import TableSkeleton from "./states/loading/table-skeleton";
import { EmptyState } from "./states/empty/empty-state";
import { PackageXIcon } from "lucide-react";
import { Link, useLoaderData } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { StoreResponse } from "@/lib/schemas/store";
import { Product, Store } from "@athena/db";

export default function Products({
  store,
  products,
}: {
  store: Store;
  products: Product[];
}) {
  return (
    <div>
      {/* {isLoading && (
        <div className="p-8">
          <TableSkeleton />
        </div>
      )} */}
      {/* {!isLoading && !error && data && data.length > 0 && (
        <div className="p-8">
          <DataTable data={data} columns={columns} />
        </div>
      )} */}
      {products && products.length > 0 && (
        <div className="p-8">
          <DataTable data={products} columns={columns} />
        </div>
      )}
      {products && products.length == 0 && (
        <EmptyState
          icon={<PackageXIcon className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No products in</p>
              <p className="font-medium">{store.name}</p>
            </div>
          }
          cta={
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/products/new"
              params={(prev) => ({
                ...prev,
                storeUrlSlug: prev.storeUrlSlug!,
                orgUrlSlug: prev.orgUrlSlug!,
              })}
            >
              <Button variant={"outline"}>
                <PlusIcon className="w-3 h-3 mr-2" />
                Add product
              </Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
