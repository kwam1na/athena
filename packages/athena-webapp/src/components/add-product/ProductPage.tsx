import { ProductStockView } from "./ProductStock";
import { ProductCategorizationView } from "./ProductCategorization";
import ProductImagesView from "./ProductImages";
import { ProductAttributesView } from "./ProductAttributesView";
import { useProduct } from "../../contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { WigTypeView } from "./WigType";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import { ProcessingFeesView } from "./ProcessingFees";
import { SheetProvider } from "./SheetProvider";

export default function ProductPage() {
  const { productData } = useProduct();
  const { activeStore } = useGetActiveStore();

  const category = useQuery(
    api.inventory.categories.getById,
    activeStore && productData.categoryId
      ? { id: productData.categoryId, storeId: activeStore._id }
      : "skip"
  );

  return (
    <SheetProvider>
      <div className="h-full container mx-auto w-full p-8 space-y-12">
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-8">
            <ProductCategorizationView />
            <ProductImagesView />
          </div>

          <div className="w-full space-y-8">
            {/* <ProductAvailabilityView /> */}
            {category?.name == "Hair" && <WigTypeView />}
            <ProductAttributesView />
          </div>
        </div>

        <div>
          <ProductStockView />
          <ProcessingFeesView />
        </div>
      </div>
    </SheetProvider>
  );
}
