import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import View from "../View";
import { useProduct } from "~/src/contexts/ProductContext";
import { FadeIn } from "../common/FadeIn";

export function CategorizationView() {
  const { activeProduct } = useGetActiveProduct();

  if (!activeProduct) return null;

  return (
    <View hideBorder hideHeaderBottomBorder className="h-auto w-full">
      <FadeIn className="py-4 grid grid-cols-3">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Category</p>
          <p className="text-sm">{activeProduct.categoryName}</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Subcategory</p>
          <p className="text-sm">{activeProduct.subcategoryName}</p>
        </div>
      </FadeIn>
    </View>
  );
}
