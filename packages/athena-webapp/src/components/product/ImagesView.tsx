import {
  AlertOctagon,
  AlertTriangle,
  Check,
  CheckCircle2,
  EyeOff,
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

export function ImagesView() {
  const { activeProductVariant } = useProduct();
  const { activeProduct } = useGetActiveProduct();

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={null}
    >
      <div className="space-y-8">
        <div className="py-4 grid grid-cols-2 gap-2">
          {activeProductVariant.images.map((image, i) => {
            return (
              <img
                key={i}
                alt="Uploaded image"
                className={`aspect-square w-full rounded-md object-cover transition-opacity duration-300 ${image.markedForDeletion ? "opacity-50" : ""}`}
                height="200"
                src={image.preview}
                width="200"
              />
            );
          })}

          {activeProductVariant.images.length === 0 && (
            <div className="w-80 h-80 border border-dashed rounded-lg flex items-center justify-center text-muted-foreground">
              <AlertOctagon className="w-4 h-4 mr-2" />
              <p className="text-sm">Missing images</p>
            </div>
          )}
        </div>
        <Button
          variant={"outline"}
          className="ml-auto"
          onClick={() => {
            window.open(
              `${config.storeFrontUrl}/shop/product/${activeProduct?._id}?variant=${activeProductVariant?.sku}`,
              "_blank"
            );
          }}
        >
          View on store
        </Button>
      </div>
    </View>
  );
}
