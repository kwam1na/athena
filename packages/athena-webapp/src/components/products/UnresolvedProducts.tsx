import { useGetProductsWithNoImages } from "~/src/hooks/useGetProducts";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { CircleCheck } from "lucide-react";
import { EmptyState } from "../states/empty/empty-state";

export const UnresolvedProducts = () => {
  const products = useGetProductsWithNoImages();

  if (!products) return null;

  return (
    <View hideBorder hideHeaderBottomBorder className="bg-background">
      <FadeIn className="py-4">
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
