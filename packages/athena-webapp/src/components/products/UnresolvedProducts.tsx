import { useGetUnresolvedProducts } from "~/src/hooks/useGetProducts";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { ArrowLeftIcon, CircleCheck } from "lucide-react";
import { EmptyState } from "../states/empty/empty-state";
import { Button } from "../ui/button";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { useSearch } from "@tanstack/react-router";

const Navigation = () => {
  const navigateBack = useNavigateBack();
  const { o } = useSearch({ strict: false });

  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        {o && (
          <Button variant="ghost" onClick={navigateBack}>
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
        )}
        <p className="font-medium">Unresolved Products</p>
      </div>
    </div>
  );
};

export const UnresolvedProducts = () => {
  const products = useGetUnresolvedProducts();

  if (!products) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="py-8">
        {products && products.length > 0 && (
          <GenericDataTable
            data={products}
            columns={productColumns}
            tableId="unresolved-products"
          />
        )}
        {products && products.length == 0 && (
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              icon={<CircleCheck className="w-16 h-16 text-muted-foreground" />}
              title={
                <div className="flex gap-1 text-sm">
                  <p className="text-muted-foreground">
                    You have no products pending review
                  </p>
                </div>
              }
            />
          </div>
        )}
      </FadeIn>
    </View>
  );
};
