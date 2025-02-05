import { ProductStockView } from "./ProductStock";
import { ProductCategorizationView } from "./ProductCategorization";
import { ProductAvailabilityView } from "./ProductAvailability";
import { ProductDetailsView } from "./ProductDetails";
import ProductImagesView from "./ProductImages";
import { ProductAttributesView } from "./ProductAttributesView";
import { useProduct } from "../../contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { WigTypeView } from "./WigType";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import { ScrollArea } from "../ui/scroll-area";
import { ProcessingFeesView } from "./ProcessingFees";

export default function ProductPage() {
  const { productData } = useProduct();
  const { activeStore } = useGetActiveStore();

  const category = useQuery(
    api.inventory.categories.getById,
    activeStore && productData.categoryId
      ? { id: productData.categoryId, storeId: activeStore._id }
      : "skip"
  )?.[0];

  return (
    <div className="h-full container mx-auto w-full p-8 space-x-32 flex">
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-8">
          <ProductDetailsView />
          <ProductAvailabilityView />
        </div>
        <ProductImagesView />
        <ProductStockView />
        <ProcessingFeesView />
      </div>

      <div className="w-full space-y-8">
        <ProductCategorizationView />
        {category?.name == "Hair" && <WigTypeView />}
        <ProductAttributesView />
      </div>
    </div>
  );
}
