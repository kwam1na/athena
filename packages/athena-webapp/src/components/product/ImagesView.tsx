import {
  AlertOctagon,
  EyeIcon,
  PenIcon,
} from "lucide-react";
import View from "../View";
import { useProduct } from "~/src/contexts/ProductContext";
import { Button } from "../ui/button";
import config from "~/src/config";
import { Link, useNavigate } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { usePermissions } from "~/src/hooks/usePermissions";
import { FadeIn } from "../common/FadeIn";
import { useEffect } from "react";
import { ProductStatus } from "./ProductStatus";

export function ImagesView() {
  const { activeProductVariant, activeProduct } = useProduct();
  const isArchived = activeProduct?.availability === "archived";

  const { hasFullAdminAccess } = usePermissions();

  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "e" &&
        hasFullAdminAccess &&
        activeProduct &&
        !isArchived
      ) {
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit",
          params: (prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            productSlug: activeProduct._id,
          }),
          search: {
            o: getOrigin(),
            variant: activeProductVariant?.sku,
          },
        });
      }

      if (event.key === "v" && activeProduct && !isArchived) {
        window.open(
          `${config.storeFrontUrl}/shop/product/${activeProduct._id}?variant=${activeProductVariant?.sku}`,
          "_blank",
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    navigate,
    activeProduct,
    activeProductVariant?.sku,
    hasFullAdminAccess,
    isArchived,
  ]);

  if (activeProduct === undefined) return null;
  if (activeProduct === null) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
      header={null}
    >
      <FadeIn className="space-y-6 sm:space-y-8">
        <div className="grid grid-cols-2 gap-2 py-2 sm:py-4">
          {activeProductVariant.images.map((image, i) => {
            return (
              <div className="relative">
                {i == 0 && (
                  <div className="font-medium text-xs absolute top-0 left-0 m-2">
                    <ProductStatus
                      product={activeProduct}
                      productVariant={activeProductVariant}
                    />
                  </div>
                )}
                <img
                  key={i}
                  alt="Uploaded image"
                  className={`aspect-square w-full rounded-md object-cover transition-opacity duration-300`}
                  height="200"
                  src={image.preview}
                  width="200"
                />
              </div>
            );
          })}

          {activeProductVariant.images.length === 0 && (
            <div className="col-span-2 flex aspect-square w-full max-w-80 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
              <AlertOctagon className="w-4 h-4 mr-2" />
              <p className="text-sm">Missing images</p>
            </div>
          )}
        </div>

        {hasFullAdminAccess && activeProduct && !isArchived && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
              params={(prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                storeUrlSlug: prev.storeUrlSlug!,
                productSlug: activeProduct._id,
              })}
              search={{
                o: getOrigin(),
                variant: activeProductVariant?.sku,
              }}
            >
              <Button
                variant="outline"
                className="flex w-full items-center gap-2 sm:w-auto"
              >
                Edit product
                <PenIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>

            <Button
              variant={"outline"}
              onClick={() => {
                window.open(
                  `${config.storeFrontUrl}/shop/product/${activeProduct?._id}?variant=${activeProductVariant?.sku}`,
                  "_blank",
                );
              }}
              className="flex w-full items-center gap-2 sm:w-auto"
            >
              View on store
              <EyeIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </FadeIn>
    </View>
  );
}
