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
import { currencyFormatter } from "~/src/lib/utils";
import View from "../View";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { TrashIcon } from "@radix-ui/react-icons";
import { PlusIcon } from "lucide-react";
import { ShopLookDialog } from "./ShopLookDialog";

export const ShopLookSection = () => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { activeStore } = useGetActiveStore();

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

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);
  const updateRanks = useMutation(api.inventory.featuredItem.updateRanks);

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

  const formatter = currencyFormatter(activeStore?.currency || "USD");

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="py-4"
      header={<p className="text-sm text-muted-foreground">Shop Look</p>}
    >
      <ShopLookDialog dialogOpen={dialogOpen} setDialogOpen={setDialogOpen} />
      <div className="py-4 space-y-8">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="featuredItemsList">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="w-full space-y-2"
              >
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
                                  {featuredItem?.product?.name}
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
        <Button variant="ghost" onClick={() => setDialogOpen(true)}>
          <PlusIcon className="w-3 h-3 mr-2" />
          <p className="text-xs">Add highlighted item</p>
        </Button>
      </div>
    </View>
  );
};
