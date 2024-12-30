import { ProductStockView } from "./add-product/ProductStock";
import { ProductCategorizationView } from "./add-product/ProductCategorization";
import { ProductAvailabilityView } from "./add-product/ProductAvailability";
import { ProductDetailsView } from "./add-product/ProductDetails";
import ProductImagesView from "./add-product/ProductImages";
import { ProductAttributesView } from "./add-product/ProductAttributesView";
import { useProduct } from "../contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { WigTypeView } from "./add-product/WigType";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useEffect } from "react";
import { useAppLayout } from "../contexts/AppLayoutContext";

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
      <div className="w-full space-y-8">
        <ProductImagesView />
        <ProductStockView />
      </div>

      <div className="w-full space-y-8">
        <div className="grid grid-cols-2 gap-8">
          <ProductDetailsView />
          <ProductAvailabilityView />
        </div>
        <ProductAttributesView />
        <ProductCategorizationView />
        <div className="grid grid-cols-2 gap-8">
          {category?.name == "Hair" && <WigTypeView />}
        </div>
      </div>
    </div>
  );
}
