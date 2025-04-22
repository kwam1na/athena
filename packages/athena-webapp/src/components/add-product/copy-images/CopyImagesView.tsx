import { useProduct } from "~/src/contexts/ProductContext";
import View from "../../View";
import { ProductVariantsDataTable } from "./table/data-table";
import { productVariantColumns } from "./table/product-variant-columns";
import { ProductVariant } from "../ProductStock";
import { CopyImagesProvider, useCopyImages } from "./CopyImagesProvider";
import { ArrowRight } from "lucide-react";
import { LoadingButton } from "../../ui/loading-button";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import { set } from "zod";
import { toast } from "sonner";
import { Id } from "~/convex/_generated/dataModel";
import { useSheet } from "../SheetProvider";
import PageHeader, { SimplePageHeader } from "../../common/PageHeader";
import { GenericDataTable } from "../../base/table/data-table";

export const CopyImagesView = () => {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto p-8"
      header={
        <PageHeader>
          <p className="font-medium text-sm px-4">Copy images</p>
        </PageHeader>
      }
    >
      <div className="space-y-8 p-8">
        <CopyImagesProvider>
          <ProductVariantsTable />
        </CopyImagesProvider>
      </div>
    </View>
  );
};

const VariantImages = ({
  type,
  variant,
  isMuted = false,
  showOverlay = false,
}: {
  variant: ProductVariant | null;
  type: "source" | "destination";
  isMuted?: boolean;
  showOverlay?: boolean;
}) => {
  return (
    <>
      {!variant && (
        <p className="text-sm text-muted-foreground text-center">
          {`No ${type} selected`}
        </p>
      )}
      {variant && (
        <div className="flex items-center gap-4">
          {variant?.images.map((image, i) => {
            return (
              <div key={i} className="relative">
                <img
                  alt="product variant"
                  className={`h-[116px] w-[116px] aspect-square w-full rounded-md object-cover transition-opacity duration-300 ${isMuted ? "opacity-50" : ""}`}
                  src={image.preview}
                />
                {showOverlay && (
                  <div className="absolute bottom-0 left-0 right-0 h-1/2 flex items-center justify-center bg-black/50 rounded-b-md">
                    <p className="text-white text-xs text-center font-medium">
                      Will be replaced
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

const ProductVariantsTable = () => {
  const { productVariants } = useProduct();

  const { toggleSheet } = useSheet();

  const updateSku = useMutation(api.inventory.products.updateSku);

  const [isUpdatingSku, setIsUpdatingSku] = useState(false);

  const { source, destination } = useCopyImages();

  const sourceVariants = productVariants.map((v) => {
    const r: ProductVariant & { type: "source" | "destination" } = {
      ...v,
      type: "source",
    };

    return r;
  });

  const destinationVariants = productVariants.map((v) => {
    const r: ProductVariant & { type: "source" | "destination" } = {
      ...v,
      type: "destination",
    };

    return r;
  });

  // console.log(productVariants);

  const copyImagesFromSourceToDestination = async () => {
    setIsUpdatingSku(true);

    try {
      const images = source?.images.map((image) => image.preview);

      await updateSku({
        id: destination?.id as Id<"productSku">,
        sku: destination?.sku,
        price: destination?.price || 0,
        netPrice: destination?.netPrice || 0,
        inventoryCount: destination?.stock || 0,
        quantityAvailable: destination?.quantityAvailable || 0,
        unitCost: destination?.cost || 0,
        isVisible: destination?.isVisible,
        length: destination?.length || 0,
        size: destination?.size,
        color: (destination as any)?.color,
        weight: destination?.weight,
        attributes: (destination as any)?.attributes || {},
        images,
      });
      toast.success("Images copied successfully");
      toggleSheet(false);
    } catch (e) {
      toast.error("Failed to copy images");
      console.error(e);
    } finally {
      setIsUpdatingSku(false);
    }
    // if (source && destination) {
    //   const updatedVariants = productVariants.map((variant) => {
    //     if (variant.sku === destination.sku) {
    //       return {
    //         ...variant,
    //         images: source.images,
    //       };
    //     }
    //     return variant;
    //   });

    //   updateProductVariants(updatedVariants);
    // }
  };

  return (
    <div className="grid grid-rows-2">
      <div className="flex items-center gap-56">
        <div className="w-[50%]">
          <GenericDataTable
            data={sourceVariants}
            columns={productVariantColumns}
          />
        </div>

        <div className="w-[50%]">
          <GenericDataTable
            data={destinationVariants}
            columns={productVariantColumns}
          />
        </div>
      </div>

      <div className="w-full p-4 flex items-center justify-center">
        <div className="border rounded-md">
          <div className="flex flex-col items-center gap-4 px-12 pt-16 pb-12 justify-center">
            <div className="space-y-8">
              {source && destination && (
                <div className="flex items-center justify-center gap-2">
                  <p className="text-center font-medium">
                    Images will be replaced
                  </p>
                </div>
              )}

              <div className="flex gap-8 items-center justify-center">
                <div className="space-y-2">
                  <VariantImages variant={source} type="source" />
                  <p className="text-sm text-center text-muted-foreground">
                    {source?.sku}
                  </p>
                </div>
                <ArrowRight className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-2">
                  <VariantImages
                    variant={destination}
                    type="destination"
                    showOverlay
                  />
                  <p className="text-sm text-center text-muted-foreground">
                    {destination?.sku}
                  </p>
                </div>
              </div>
            </div>

            {source && destination && (
              <LoadingButton
                onClick={copyImagesFromSourceToDestination}
                variant={"outline"}
                isLoading={isUpdatingSku}
              >
                Copy images
              </LoadingButton>
            )}
          </div>
        </div>
      </div>

      {/* <div className="grid grid-cols-2 gap-8">
        <VariantImages variant={source} type="source" />
        <VariantImages variant={destination} type="destination" />
      </div> */}
    </div>
  );
};
