import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords, currencyFormatter } from "~/src/lib/utils";
import View from "../View";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { TrashIcon } from "@radix-ui/react-icons";
import { Image, Info, PencilIcon, PlusIcon } from "lucide-react";
import { ShopLookDialog } from "./ShopLookDialog";
import { getOrigin } from "~/src/lib/navigationUtils";

import { ShopLookImageUploader } from "./ShopLookImageUploader";
import { toast } from "sonner";

export const ShopLookSection = () => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { activeStore } = useGetActiveStore();

  const [shopTheLookImage, setShopTheLookImage] = useState<
    string | undefined
  >();

  const featuredItemsQuery = useQuery(
    api.inventory.featuredItem.getAll,
    activeStore?._id ? { storeId: activeStore._id, type: "shop_look" } : "skip"
  );

  const [featuredItems, setFeaturedItems] = useState<any[] | null>(null);

  useEffect(() => {
    if (
      (featuredItemsQuery && !featuredItems) ||
      featuredItemsQuery?.length !== featuredItems?.length
    ) {
      const sortedItems = featuredItemsQuery?.sort(
        (a: any, b: any) => a.rank - b.rank
      );

      sortedItems && setFeaturedItems(sortedItems);
    }
  }, [featuredItemsQuery, featuredItems]);

  useEffect(() => {
    if (activeStore?.config?.shopTheLookImage) {
      setShopTheLookImage(activeStore?.config?.shopTheLookImage);
    }
  }, [activeStore?.config?.shopTheLookImage]);

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);
  const updateRanks = useMutation(api.inventory.featuredItem.updateRanks);
  const updateConfig = useMutation(api.inventory.stores.updateConfig);

  const handleHighlightedItem = async (featuredItem: any) => {
    removeHighlightedItem({
      id: featuredItem._id,
    });
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !featuredItems) return;

    const items = Array.from(featuredItems);
    const [movedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, movedItem);

    setFeaturedItems(items);

    const newRanks = items.map((item: any, index) => ({
      id: item._id,
      rank: index,
    }));

    updateRanks({ ranks: newRanks });
  };

  const handleImageUpdate = async (newImageUrl: string) => {
    console.log("newImageUrl", newImageUrl);
    try {
      await updateConfig({
        id: activeStore?._id!,
        config: {
          ...activeStore?.config,
          shopTheLookImage: newImageUrl,
        },
      });
      setShopTheLookImage(newImageUrl);
      toast.success("Shop the Look image updated");
    } catch (error) {
      console.error("Failed to update store configuration:", error);
      toast.error("Failed to update store configuration");
      throw error; // Re-throw so component can handle it
    }
  };

  const formatter = currencyFormatter(activeStore?.currency || "USD");

  const featuredItem = featuredItems?.[0];

  const hasHighlightedItem = !!featuredItem;

  const ctaText = hasHighlightedItem ? "Update product" : "Add product";

  const ctaIcon = hasHighlightedItem ? (
    <PencilIcon className="w-2.5 h-2.5 mr-2" />
  ) : (
    <PlusIcon className="w-2.5 h-2.5 mr-2" />
  );

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="py-4"
      header={<p className="text-sm text-muted-foreground">Shop The Look</p>}
    >
      <ShopLookDialog
        action={hasHighlightedItem ? "edit" : "add"}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        featuredItemId={featuredItem?._id}
      />
      <div className="py-4 space-y-8">
        <ShopLookImageUploader
          currentImageUrl={activeStore?.config?.shopTheLookImage}
          onImageUpdate={handleImageUpdate}
          disabled={!activeStore}
        />
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="featuredItemsList">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="w-full space-y-2"
              >
                <p className="text-sm text-muted-foreground">
                  Highlighted product
                </p>
                {featuredItems?.map((featuredItem: any, index: number) => (
                  <Draggable
                    key={featuredItem._id}
                    draggableId={featuredItem._id}
                    index={index}
                  >
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className="flex items-center justify-between bg-background py-4"
                      >
                        <div className="flex items-center gap-4">
                          {featuredItem?.product && (
                            <Link
                              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                              params={(params) => ({
                                ...params,
                                orgUrlSlug: params.orgUrlSlug!,
                                storeUrlSlug: params.storeUrlSlug!,
                                productSlug: featuredItem.product._id,
                              })}
                              search={{ o: getOrigin() }}
                              className="flex items-center gap-4"
                            >
                              <img
                                src={
                                  featuredItem?.product?.skus[0]?.images[0] ||
                                  "/placeholder.jpg"
                                }
                                alt={featuredItem?.product?.name || "Product"}
                                className="w-16 h-16 aspect-square object-cover rounded-md"
                              />
                              <div className="flex flex-col gap-2">
                                <p className="text-sm">
                                  {capitalizeWords(featuredItem?.product?.name)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatter.format(
                                    featuredItem?.product?.skus[0]?.price
                                  )}
                                </p>
                              </div>
                            </Link>
                          )}
                        </div>

                        <Button
                          variant={"ghost"}
                          onClick={() => handleHighlightedItem(featuredItem)}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setDialogOpen(true)}
            // disabled={featuredItems?.length == 1}
          >
            {ctaIcon}
            <p className="text-xs">{ctaText}</p>
          </Button>

          {/* {featuredItems?.length == 1 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Only one product can be highlighted</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )} */}
        </div>
      </div>
    </View>
  );
};
