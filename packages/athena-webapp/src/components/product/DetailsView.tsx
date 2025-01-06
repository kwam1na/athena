import { Check, CheckCircle2 } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useProduct } from "~/src/contexts/ProductContext";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function DetailsView() {
  const { activeStore } = useGetActiveStore();

  const { activeProductVariant } = useProduct();

  if (!activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Details</p>}
    >
      <div className="py-4 grid grid-cols-3">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Price</p>
          <p className="text-sm">
            {formatter.format(activeProductVariant.price || 0)}
          </p>
        </div>

        {Boolean(activeProductVariant.cost) && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Cost</p>
            <p className="text-sm">
              {formatter.format(activeProductVariant.cost || 0)}
            </p>
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Stock</p>
          <p className="text-sm">{activeProductVariant.stock}</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Available</p>
          <p className="text-sm">{activeProductVariant.quantityAvailable}</p>
        </div>
      </div>
    </View>
  );
}
