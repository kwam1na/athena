import { Check, CheckCircle2 } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useProduct } from "~/src/contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function ImagesView() {
  const { activeStore } = useGetActiveStore();

  const { activeProductVariant } = useProduct();

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Images</p>}
    >
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
      </div>
    </View>
  );
}
