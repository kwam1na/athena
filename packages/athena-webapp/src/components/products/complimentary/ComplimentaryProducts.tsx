import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { useCreateComplimentaryProduct } from "@/hooks/useCreateComplimentaryProduct";
import { useToggleComplimentaryProductActive } from "@/hooks/useToggleComplimentaryProductActive";
import { Id } from "~/convex/_generated/dataModel";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "../../states/empty/empty-state";
import { Gift, PlusIcon } from "lucide-react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { getOrigin } from "~/src/lib/navigationUtils";
import { GenericDataTable } from "../../base/table/data-table";
import { productColumns } from "../products-table/components/productColumns";
import { ComplimentaryProduct } from "~/types";
import { complimentaryProductsColumns } from "./complimentaryProductsColumn";

interface ComplimentaryProductsProps {
  products: ComplimentaryProduct[];
}

export default function ComplimentaryProducts({
  products,
}: ComplimentaryProductsProps) {
  const createProduct = useCreateComplimentaryProduct();
  const toggleActive = useToggleComplimentaryProductActive();
  const { user } = useAuth();

  const skus = products.map((product) => product.productSku);

  return (
    <div className="container mx-auto">
      {products && products.length > 0 && (
        <div className="py-8 space-y-4">
          <div className="flex justify-end gap-2">
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/new"
              params={(prev) => ({
                ...prev,
                storeUrlSlug: prev.storeUrlSlug!,
                orgUrlSlug: prev.orgUrlSlug!,
              })}
              search={{
                o: getOrigin(),
              }}
            >
              <Button variant={"ghost"}>
                <PlusIcon className="w-3 h-3 mr-2" />
                New collection
              </Button>
            </Link>

            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/new"
              params={(prev) => ({
                ...prev,
                storeUrlSlug: prev.storeUrlSlug!,
                orgUrlSlug: prev.orgUrlSlug!,
              })}
              search={{
                o: getOrigin(),
              }}
            >
              <Button variant={"ghost"}>
                <PlusIcon className="w-3 h-3 mr-2" />
                New product
              </Button>
            </Link>
          </div>
          <GenericDataTable
            data={skus}
            columns={complimentaryProductsColumns}
          />
        </div>
      )}
      {products && products.length == 0 && (
        <div className="flex items-center justify-center min-h-[60vh] w-full">
          <EmptyState
            icon={<Gift className="w-16 h-16 text-muted-foreground" />}
            title={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">
                  No complimentary products
                </p>
              </div>
            }
            cta={
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/new"
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
                  Create product
                </Button>
              </Link>
            }
          />
        </div>
      )}
    </div>
  );
}
