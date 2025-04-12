import { columns } from "./products-table/components/columns";
import { DataTable } from "./products-table/components/data-table";
import { EmptyState } from "../states/empty/empty-state";
import { PackageXIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { Product } from "~/types";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import { getOrigin } from "~/src/lib/navigationUtils";

export default function StoreProducts({ products }: { products: Product[] }) {
  const { activeStore } = useGetActiveStore();

  return (
    <div className="container mx-auto">
      {products && products.length > 0 && (
        <div className="py-8">
          <DataTable data={products} columns={columns} />
        </div>
      )}
      {products && products.length == 0 && (
        <EmptyState
          icon={<PackageXIcon className="w-16 h-16 text-muted-foreground" />}
          text={
            <div className="flex gap-1 text-sm">
              <p className="text-muted-foreground">No products in</p>
              <p className="font-medium">{activeStore?.name}</p>
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
              search={{
                o: getOrigin(),
              }}
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
