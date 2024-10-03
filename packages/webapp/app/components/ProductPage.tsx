import { ProductStockView } from "./add-product/ProductStock";
import { ProductCategorizationView } from "./add-product/ProductCategorization";
import { ProductAvailabilityView } from "./add-product/ProductAvailability";
import { ProductDetailsView } from "./add-product/ProductDetails";
import ProductImagesView from "./add-product/ProductImages";

export default function ProductPage() {
  return (
    <div className="h-full w-full p-8 space-x-8 flex">
      <div className="w-full space-y-8">
        <ProductDetailsView />
        <ProductStockView />
        <ProductCategorizationView />
      </div>

      <div className="w-full space-y-8">
        <ProductAvailabilityView />
        <ProductImagesView />
      </div>
    </div>
  );
}
