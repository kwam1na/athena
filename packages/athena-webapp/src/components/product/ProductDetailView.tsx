import { CheckCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import { ArchiveRestore } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";

import View from "../View";
import { LoadingButton } from "../ui/loading-button";
import { SKUSelector } from "./SKUSelector";
import { ProductProvider } from "~/src/contexts/ProductContext";
import { DetailsView } from "./DetailsView";
import { AttributesView } from "./AttributesView";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { ImagesView } from "./ImagesView";
import { ProductStatus } from "./ProductStatus";
import { ComposedPageHeader } from "../common/PageHeader";
import { capitalizeWords } from "~/src/lib/utils";
import { AnalyticsInsights } from "./AnalyticsInsights";
import { BarcodeView } from "./BarcodeView";
import { EmptyState } from "../states/empty/empty-state";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { presentUnexpectedErrorToast } from "~/src/lib/errors/presentUnexpectedErrorToast";
import { ProductOperationalTimeline } from "./ProductOperationalTimeline";

const ProductDetailViewHeader = () => {
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const { activeProduct } = useGetActiveProduct({ includeArchived: true });
  const { activeStore } = useGetActiveStore();
  const unarchiveProduct = useMutation(api.inventory.products.unarchive);

  if (activeProduct === undefined) return null;

  const isArchived = activeProduct?.availability === "archived";

  const handleUnarchiveProduct = async () => {
    if (!activeProduct || !activeStore) {
      return;
    }

    try {
      setIsUnarchiving(true);
      await unarchiveProduct({
        id: activeProduct._id,
        storeId: activeStore._id,
      });

      toast(`Product '${activeProduct.name}' unarchived`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch {
      presentUnexpectedErrorToast("Something went wrong");
    } finally {
      setIsUnarchiving(false);
    }
  };

  return (
    <ComposedPageHeader
      className="h-auto min-h-10 py-3"
      leadingContent={
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <p className="min-w-0 truncate text-sm">
            {capitalizeWords(activeProduct?.name || "")}
          </p>
          {activeProduct && <ProductStatus product={activeProduct} />}
        </div>
      }
      trailingContent={
        isArchived ? (
          <LoadingButton
            isLoading={isUnarchiving}
            variant="outline"
            onClick={handleUnarchiveProduct}
            className="flex items-center gap-2"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            <span>Unarchive</span>
          </LoadingButton>
        ) : null
      }
    />
  );
};

export const ProductDetailView = () => {
  const { activeProduct } = useGetActiveProduct({ includeArchived: true });

  return (
    <ProductProvider includeArchived>
      <View header={<ProductDetailViewHeader />}>
        <div className="container mx-auto h-full w-full space-y-8 p-4 sm:p-6 lg:space-y-12 lg:p-8">
          {activeProduct !== null && (
            <div className="grid gap-8 lg:min-h-[720px] lg:grid-cols-2 lg:gap-16">
              <div className="order-2 space-y-6 lg:order-1 lg:col-start-1 lg:row-start-1 lg:space-y-8">
                <SKUSelector />

                <DetailsView />

                <AttributesView />

                {/* <CategorizationView /> */}

                <BarcodeView />
              </div>

              <div className="order-1 lg:order-2 lg:col-start-2 lg:row-start-1">
                <ImagesView />
              </div>

              <div className="order-3 space-y-10 lg:col-start-2 lg:row-start-2 lg:space-y-16">
                <AnalyticsInsights />

                <ProductOperationalTimeline />
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
