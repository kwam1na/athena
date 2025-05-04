import { useGetProductsWithNoImages } from "~/src/hooks/useGetProducts";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { GenericDataTable } from "../base/table/data-table";
import { productColumns } from "./products-table/components/productColumns";
import { AlertCircleIcon, AlertOctagon, CircleCheck } from "lucide-react";
import { EmptyState } from "../states/empty/empty-state";

const Navigation = () => {
  return (
    <div className="flex gap-2 w-[40%] items-center p-4 rounded-lg text-yellow-700 bg-yellow-50">
      <AlertOctagon className="h-4 w-4" />
      <div className="flex items-center">
        <p className="text-sm">These products are missing images</p>
      </div>
    </div>
  );
};

export const UnresolvedProducts = () => {
  const products = useGetProductsWithNoImages();

  if (!products) return null;

  const hasProducts = products.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasProducts && <Navigation />}
    >
      <FadeIn className="py-4">
        {products && products.length > 0 && (
          <GenericDataTable data={products} columns={productColumns} />
        )}
        {products && products.length == 0 && (
          <EmptyState
            icon={<CircleCheck className="w-16 h-16 text-muted-foreground" />}
            text={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">
                  You have no products pending review
                </p>
              </div>
            }
          />
        )}
      </FadeIn>
    </View>
  );
};
