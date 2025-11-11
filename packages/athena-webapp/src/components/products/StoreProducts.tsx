import { productColumns } from "./products-table/components/productColumns";
import { DataTable } from "./products-table/components/data-table";
import { EmptyState } from "../states/empty/empty-state";
import { PackageXIcon } from "lucide-react";
import { Link, useSearch } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { Product } from "~/types";
import { getOrigin } from "~/src/lib/navigationUtils";
import { slugToWords } from "~/src/lib/utils";

export default function StoreProducts({ products }: { products: Product[] }) {
  const { categorySlug } = useSearch({ strict: false });

  return (
    <div className="container mx-auto">
      {products && products.length > 0 && (
        <div className="py-8">
          <DataTable data={products} columns={productColumns} />
        </div>
      )}
      {products && products.length == 0 && (
        <div className="flex items-center justify-center min-h-[60vh] w-full">
          <EmptyState
            icon={<PackageXIcon className="w-16 h-16 text-muted-foreground" />}
            title={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">{`No ${slugToWords(categorySlug ?? "products")}`}</p>
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
        </div>
      )}
    </div>
  );
}
