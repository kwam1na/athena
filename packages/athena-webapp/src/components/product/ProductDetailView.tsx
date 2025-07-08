import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import View from "../View";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import { SKUSelector } from "./SKUSelector";
import { ProductProvider, useProduct } from "~/src/contexts/ProductContext";
import { DetailsView } from "./DetailsView";
import { AttributesView } from "./AttributesView";
import { CategorizationView } from "./CategorizationView";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { ImagesView } from "./ImagesView";
import { PenIcon } from "lucide-react";
import { ProductStatus } from "./ProductStatus";
import { ProductStockStatus } from "./ProductStock";
import { ComposedPageHeader } from "../common/PageHeader";
import { capitalizeWords } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { AnalyticsInsights } from "./AnalyticsInsights";

const ProductDetailViewHeader = () => {
  const { activeProduct } = useGetActiveProduct();

  if (!activeProduct) return null;

  return (
    <ComposedPageHeader
      leadingContent={
        <>
          <p className="text-sm">{capitalizeWords(activeProduct.name)}</p>

          <div className="text-xs flex items-center gap-4">
            <ProductStatus product={activeProduct} />
          </div>
        </>
      }
    />
  );
};

export const ProductDetailView = () => {
  return (
    <ProductProvider>
      <View header={<ProductDetailViewHeader />}>
        <div className="container mx-auto h-full w-full p-8 space-y-12">
          <div className="grid grid-cols-2">
            <div className="space-y-8">
              <SKUSelector />

              <DetailsView />

              <AttributesView />

              <CategorizationView />
            </div>

            <div className="space-y-8">
              <ImagesView />
              <AnalyticsInsights />
            </div>
          </div>
        </div>
      </View>
    </ProductProvider>
  );
};
