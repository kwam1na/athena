import { useQuery } from "convex/react";
import View from "../View";
import { useProduct } from "~/src/contexts/ProductContext";
import { api } from "~/convex/_generated/api";
import { DraftingCompass, Palette, Ruler } from "lucide-react";
import { Id } from "~/convex/_generated/dataModel";

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
    !Boolean(activeProductVariant.length) &&
    !Boolean(activeProductVariant.size)
  ) {
    return null;
  }

  return (
    <View hideBorder hideHeaderBottomBorder className="h-auto w-full">
      <div className="py-4 grid grid-cols-3">
        {color && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Palette className="h-3.5 w-3.5" />
              <p className="text-sm">Color</p>
            </div>
            <p className="text-sm">{color?.name}</p>
          </div>
        )}

        {Boolean(activeProductVariant.length) && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Ruler className="h-3.5 w-3.5" />
              <p className="text-sm text-muted-foreground">Length (inches)</p>
            </div>
            <p className="text-sm">{activeProductVariant.length}</p>
          </div>
        )}

        {Boolean(activeProductVariant.size) && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DraftingCompass className="h-3.5 w-3.5" />
              <p className="text-sm text-muted-foreground">Size</p>
            </div>
            <p className="text-sm">{activeProductVariant.size}</p>
          </div>
        )}
      </div>
    </View>
  );
}
