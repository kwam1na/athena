import { Landmark } from "lucide-react";
import View from "../View";
import { currencyFormatter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { useProduct } from "~/src/contexts/ProductContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { FadeIn } from "../common/FadeIn";
import { productStockTextClass } from "./productStockPresentation";

export function DetailsView() {
  const { activeStore } = useGetActiveStore();

  const { activeProductVariant, activeProduct } = useProduct();

  if (!activeStore || activeProduct === undefined) return null;

  if (activeProduct === null) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const stockLabelColor = productStockTextClass(
    activeProductVariant.quantityAvailable,
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
    >
      <FadeIn className="grid grid-cols-2 gap-x-4 gap-y-6 py-4 sm:grid-cols-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 sm:space-y-4">
          <p className="text-sm text-muted-foreground">Price</p>
          <div className="flex items-center gap-2">
            <p className="text-sm">
              {formatter.format(activeProductVariant.price || 0)}
            </p>
            {!activeProduct?.areProcessingFeesAbsorbed && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Landmark className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Includes payment processing fees</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {Boolean(activeProductVariant.cost) && (
          <div className="min-w-0 space-y-3 sm:space-y-4">
            <p className="text-sm text-muted-foreground">Cost</p>
            <p className="text-sm">
              {formatter.format(activeProductVariant.cost || 0)}
            </p>
          </div>
        )}

        <div className="min-w-0 space-y-3 sm:space-y-4">
          <p className="text-sm text-muted-foreground">Stock</p>
          <div className="flex items-center gap-2">
            <p className={`font-numeric text-sm tabular-nums ${stockLabelColor}`}>
              {activeProductVariant.stock}
            </p>
            {/* <span className="text-xs">
              <ProductStockStatus productVariant={activeProductVariant} />
            </span> */}
          </div>
        </div>

        <div className="min-w-0 space-y-3 sm:space-y-4">
          <p className="text-sm text-muted-foreground">Sellable</p>
          <p className="font-numeric text-sm tabular-nums">
            {activeProductVariant.quantityAvailable}
          </p>
        </div>
      </FadeIn>
    </View>
  );
}
