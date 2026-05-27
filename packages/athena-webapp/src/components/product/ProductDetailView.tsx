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
      leadingContent={
        <div className="flex items-center gap-3">
          <p className="text-sm">
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
