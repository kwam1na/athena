import { useQuery } from "convex/react";
import View from "../View";
import { useProduct } from "~/src/contexts/ProductContext";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";

export function AttributesView() {
  const { activeProductVariant } = useProduct();
  const { activeProduct } = useGetActiveProduct();

  // console.log("activeProductVariant", activeProduct);

  // const { activeStore } = useGetActiveStore();

  const color = useQuery(
    api.inventory.colors.getById,
    activeProduct && activeProductVariant.color
      ? {
          storeId: activeProduct?.storeId,
          id: activeProductVariant.color,
        }
      : "skip"
  );

  // console.log("color", color);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={
        <p className="text-sm text-sm text-muted-foreground">Attributes</p>
      }
    >
      <div className="p-8 grid grid-cols-3">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Color</p>
          <p className="text-sm">{color?.name}</p>
        </div>

        {Boolean(activeProductVariant.length) && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Length (inches)</p>
            <p className="text-sm">{activeProductVariant.length}</p>
          </div>
        )}

        {Boolean(activeProductVariant.size) && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Size</p>
            <p className="text-sm">{activeProductVariant.size}</p>
          </div>
        )}
      </div>
    </View>
  );
}
