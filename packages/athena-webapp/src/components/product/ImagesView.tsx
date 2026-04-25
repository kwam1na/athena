import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  EyeIcon,
  EyeOff,
  PenIcon,
} from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useProduct } from "~/src/contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Button } from "../ui/button";
import config from "~/src/config";
import useGetActiveProduct from "~/src/hooks/useGetActiveProduct";
import { Link, useNavigate } from "@tanstack/react-router";
import { getOrigin } from "~/src/lib/navigationUtils";
import { usePermissions } from "~/src/hooks/usePermissions";
import { FadeIn } from "../common/FadeIn";
import { Skeleton } from "../ui/skeleton";
import { useEffect } from "react";
import { ProductStatus } from "./ProductStatus";

export function ImagesView() {
  const { activeProductVariant } = useProduct();
  const { activeProduct } = useGetActiveProduct();

  const { hasFullAdminAccess } = usePermissions();

  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "e" && hasFullAdminAccess && activeProduct) {
        navigate({
          to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit",
          params: (prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            productSlug: activeProduct?._id!,
          }),
          search: {
            o: getOrigin(),
            variant: activeProductVariant?.sku,
          },
        });
      }

      if (event.key === "v" && activeProduct) {
        window.open(
          `${config.storeFrontUrl}/shop/product/${activeProduct?._id}?variant=${activeProductVariant?.sku}`,
          "_blank",
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, activeProduct?._id, activeProductVariant?.sku]);

  if (activeProduct === undefined)
    return <Skeleton className="w-[320px] h-80" />;
  if (activeProduct === null) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={null}
    >
      <FadeIn className="space-y-8">
        <div className="py-4 grid grid-cols-2 gap-2">
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
            <div className="w-80 h-80 border border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
              <AlertOctagon className="w-4 h-4 mr-2" />
              <p className="text-sm">Missing images</p>
            </div>
          )}
        </div>

        {hasFullAdminAccess && activeProduct && (
          <div className="flex items-center gap-4">
            <Link
              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug/edit"
              params={(prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                storeUrlSlug: prev.storeUrlSlug!,
                productSlug: activeProduct?._id!,
              })}
              search={{
                o: getOrigin(),
                variant: activeProductVariant?.sku,
              }}
            >
              <Button variant="outline" className="flex items-center gap-2">
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
              className="flex items-center gap-2"
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
