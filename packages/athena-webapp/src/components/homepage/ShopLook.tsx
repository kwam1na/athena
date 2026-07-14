import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords } from "~/src/lib/utils";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { TrashIcon } from "@radix-ui/react-icons";
import { PencilIcon, PlusIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { ShopLookDialog } from "./ShopLookDialog";
import { getOrigin } from "~/src/lib/navigationUtils";

import { ShopLookImageUploader } from "./ShopLookImageUploader";
import { toast } from "sonner";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import { formatStoredCurrencyAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";
import type { Product } from "~/types";
import { HomepagePlacementProductImage } from "./HomepagePlacementProductImage";

type ShopLookItem = {
  _id: Id<"featuredItem">;
  rank?: number;
  product?: Product | null;
};

export const ShopLookSection = ({ readOnly = false }: { readOnly?: boolean }) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { activeStore } = useGetActiveStore();
  const storeConfig = useMemo(
    () => getStoreConfigV2(activeStore),
    [activeStore],
  );

  const featuredItemsQuery = useQuery(
    api.inventory.featuredItem.getAll,
    activeStore?._id ? { storeId: activeStore._id, type: "shop_look" } : "skip"
  ) as ShopLookItem[] | undefined;

  const [featuredItems, setFeaturedItems] = useState<ShopLookItem[] | null>(
    null,
  );

  useEffect(() => {
    if (!featuredItemsQuery) {
      return;
    }

    setFeaturedItems(
      [...featuredItemsQuery].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    );
  }, [featuredItemsQuery]);

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);
  const patchConfig = useMutation(api.inventory.stores.patchConfigV2);

  const handleHighlightedItem = async (featuredItem: ShopLookItem) => {
    try {
      await removeHighlightedItem({
        id: featuredItem._id,
      });
      toast.success("Shop the Look product removed");
    } catch (error) {
      console.error("Failed to remove Shop the Look product:", error);
      toast.error("Shop the Look product was not removed. Try again.");
    }
  };

  const handleImageUpdate = async (newImageUrl: string) => {
    if (!activeStore) {
      toast.error("Select a store before updating the Shop the Look image");
      return;
    }

    try {
      await patchConfig({
        id: activeStore._id,
        patch: {
          media: {
            images: {
              shopTheLookImage: newImageUrl,
            },
          },
        },
      });
      toast.success("Shop the Look image updated");
    } catch (error) {
      console.error("Failed to update store configuration:", error);
      toast.error("Failed to update store configuration");
      throw error; // Re-throw so component can handle it
    }
  };

  const currency = activeStore?.currency || "USD";

  const featuredItem = featuredItems?.[0];

  const hasHighlightedItem = !!featuredItem;

  const ctaText = hasHighlightedItem ? "Update product" : "Add product";

  const ctaIcon = hasHighlightedItem ? (
    <PencilIcon className="w-2.5 h-2.5 mr-2" />
  ) : (
    <PlusIcon className="w-2.5 h-2.5 mr-2" />
  );

  return (
    <div className="space-y-layout-lg">
      <ShopLookDialog
        action={hasHighlightedItem ? "edit" : "add"}
        disabled={readOnly}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        featuredItemId={featuredItem?._id}
      />
      <div className="space-y-layout-lg">
        <ShopLookImageUploader
          currentImageUrl={storeConfig.media.images.shopTheLookImage}
          onImageUpdate={handleImageUpdate}
          disabled={!activeStore || readOnly}
        />
        <div className="w-full space-y-layout-sm">
          <p className="text-sm font-medium text-foreground">
            Highlighted product
          </p>
          {featuredItem?.product ? (
            <div className="flex flex-col gap-layout-sm rounded-md border border-border bg-background p-layout-sm sm:flex-row sm:items-center sm:justify-between">
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                params={(params) => ({
                  ...params,
                  orgUrlSlug: params.orgUrlSlug!,
                  storeUrlSlug: params.storeUrlSlug!,
                  productSlug: featuredItem.product!._id,
                })}
                search={{ o: getOrigin() }}
                className="flex min-w-0 items-center gap-4"
              >
                <HomepagePlacementProductImage
                  alt={featuredItem.product.name || "Product"}
                  product={featuredItem.product}
                />
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm">
                    {capitalizeWords(featuredItem.product.name)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatStoredCurrencyAmount(
                      currency,
                      featuredItem.product.skus[0]?.price ?? 0,
                      { revealMinorUnits: true },
                    )}
                  </p>
                </div>
              </Link>

              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={`Remove ${capitalizeWords(featuredItem.product.name)} from Shop the Look`}
                      disabled={readOnly}
                      onClick={() => handleHighlightedItem(featuredItem)}
                      size="icon"
                      title={`Remove ${capitalizeWords(featuredItem.product.name)} from Shop the Look`}
                      variant="ghost"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ) : (
            <div className="w-fit max-w-full rounded-md border border-dashed border-border bg-background p-layout-md text-sm text-muted-foreground">
              Add the product customers should reach from this visual story.
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            onClick={() => setDialogOpen(true)}
          >
            {ctaIcon}
            <p className="text-xs">{ctaText}</p>
          </Button>
        </div>
      </div>
    </div>
  );
};
