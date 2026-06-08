import { useQuery } from "convex/react";
import View from "../View";
import { useProduct } from "~/src/contexts/ProductContext";
import { api } from "~/convex/_generated/api";
import { DraftingCompass, Palette, Ruler } from "lucide-react";
import { Id } from "~/convex/_generated/dataModel";
import { FadeIn } from "../common/FadeIn";

export function AttributesView() {
  const { activeProductVariant } = useProduct();

  const color = useQuery(
    api.inventory.colors.getById,
    activeProductVariant.color
      ? { id: activeProductVariant.color as Id<"color"> }
      : "skip"
  );

  if (
    !color &&
    !activeProductVariant.length &&
    !activeProductVariant.size
  ) {
    return null;
  }

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      fullHeight={false}
      lockDocumentScroll={false}
      className="w-full"
    >
      <FadeIn className="grid grid-cols-1 gap-6 py-4 sm:grid-cols-3">
        {color && (
          <div className="min-w-0 space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Palette className="h-3.5 w-3.5" />
              <p className="text-sm">Color</p>
            </div>
            <p className="text-sm">{color?.name}</p>
          </div>
        )}

        {Boolean(activeProductVariant.length) && (
          <div className="min-w-0 space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Ruler className="h-3.5 w-3.5" />
              <p className="text-sm text-muted-foreground">Length (inches)</p>
            </div>
            <p className="text-sm">{activeProductVariant.length}</p>
          </div>
        )}

        {Boolean(activeProductVariant.size) && (
          <div className="min-w-0 space-y-3 sm:space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DraftingCompass className="h-3.5 w-3.5" />
              <p className="text-sm text-muted-foreground">Size</p>
            </div>
            <p className="text-sm">{activeProductVariant.size}</p>
          </div>
        )}
      </FadeIn>
    </View>
  );
}
