import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import View from "../View";
import { Button } from "../ui/button";
import { ArrowLeftIcon, TrashIcon } from "@radix-ui/react-icons";
import { Badge } from "../ui/badge";
import { SKUSelector } from "./SKUSelector";
import { ProductProvider, useProduct } from "~/src/contexts/ProductContext";
import { DetailsView } from "./DetailsView";
import { AttributesView } from "./AttributesView";
import { CategorizationView } from "./CategorizationView";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { ImagesView } from "./ImagesView";
import { PackageX, PenIcon, Trash } from "lucide-react";
import { ProductStatus } from "./ProductStatus";
import { ProductStockStatus } from "./ProductStock";
import { ComposedPageHeader } from "../common/PageHeader";
import { capitalizeWords } from "~/src/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
import { AnalyticsInsights } from "./AnalyticsInsights";
import { BarcodeView } from "./BarcodeView";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";

const ProductDetailViewHeader = () => {
  const { activeProduct } = useGetActiveProduct();

  if (activeProduct === undefined) return null;

  return (
    <ComposedPageHeader
      leadingContent={
        <>
          <p className="text-sm">
            {capitalizeWords(activeProduct?.name || "")}
          </p>
        </>
      }
    />
  );
};

export const ProductDetailView = () => {
  const { activeProduct } = useGetActiveProduct();

  return (
    <ProductProvider>
      <View header={<ProductDetailViewHeader />} fullHeight lockDocumentScroll>
        <div className="container mx-auto h-full w-full p-8 space-y-12">
          {activeProduct !== null && (
            <div className="grid grid-cols-2 gap-16 min-h-[720px]">
              <div className="space-y-8">
                <SKUSelector />

                <DetailsView />

                <AttributesView />

                {/* <CategorizationView /> */}

                <BarcodeView />
              </div>

              <div className="space-y-16">
                <ImagesView />

                <AnalyticsInsights />
              </div>
            </div>
          )}

          {activeProduct === null && (
            <div className="flex items-center justify-center min-h-[720px] w-full">
              <EmptyState
                icon={<TrashIcon className="w-16 h-16 text-muted-foreground" />}
                title={
                  <div className="flex gap-1 text-sm">
                    <p className="text-muted-foreground">
                      This product has been deleted
                    </p>
                  </div>
                }
              />
            </div>
          )}
        </div>
      </View>
    </ProductProvider>
  );
};
