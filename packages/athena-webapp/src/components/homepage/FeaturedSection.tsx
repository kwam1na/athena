import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords } from "~/src/lib/utils";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { TrashIcon } from "@radix-ui/react-icons";
import { ArrowDown, ArrowUp, GripVertical, PlusIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { FeaturedSectionDialog } from "./FeaturedSectionDialog";
import { getOrigin } from "~/src/lib/navigationUtils";
import { formatStoredCurrencyAmount } from "~/src/lib/pos/displayAmounts";
import { toast } from "sonner";
import { sortHomepageRankedItems } from "~/shared/homepageRanking";
import type { Id } from "~/convex/_generated/dataModel";
import type { Category, Product, Subcategory } from "~/types";
import { HomepagePlacementProductImage } from "./HomepagePlacementProductImage";

type FeaturedHomepageItem = {
  _id: Id<"featuredItem">;
  rank?: number;
  product?: Product | null;
  category?: Category | null;
  subcategory?: Subcategory | null;
};

export const FeaturedSection = ({ readOnly = false }: { readOnly?: boolean }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);

  const { activeStore } = useGetActiveStore();

  const featuredItemsQuery = useQuery(
    api.inventory.featuredItem.getAll,
    activeStore?._id ? { storeId: activeStore._id, type: "regular" } : "skip"
  ) as FeaturedHomepageItem[] | undefined;

  const [featuredItems, setFeaturedItems] = useState<
    FeaturedHomepageItem[] | null
  >(null);

  useEffect(() => {
    if (!featuredItemsQuery) {
      return;
    }

    setFeaturedItems(sortHomepageRankedItems(featuredItemsQuery));
  }, [featuredItemsQuery]);

  const removeHighlightedItem = useMutation(api.inventory.featuredItem.remove);
  const updateRanks = useMutation(api.inventory.featuredItem.updateRanks);

  const handleHighlightedItem = async (featuredItem: FeaturedHomepageItem) => {
    try {
      await removeHighlightedItem({
        id: featuredItem._id,
      });
      toast.success("Highlighted item removed");
    } catch (error) {
      console.error("Failed to remove highlighted item:", error);
      toast.error("Highlighted item was not removed. Try again.");
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (readOnly || !result.destination || !featuredItems) return;
    if (result.destination.index === result.source.index) return;

    const previousItems = featuredItems;
    const items = Array.from(featuredItems);
    const [movedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, movedItem);

    setFeaturedItems(items);

    const newRanks = items.map((item, index) => ({
      id: item._id,
      rank: index,
    }));

    setIsOrdering(true);
    try {
      await updateRanks({ ranks: newRanks });
    } catch (error) {
      console.error("Failed to update highlighted content order:", error);
      setFeaturedItems(previousItems);
      toast.error("Highlighted content order was not saved. Try again.");
    } finally {
      setIsOrdering(false);
    }
  };

  const saveOrder = async (
    items: FeaturedHomepageItem[],
    previousItems: FeaturedHomepageItem[] | null,
  ) => {
    setFeaturedItems(items);
    setIsOrdering(true);
    try {
      await updateRanks({
        ranks: items.map((item, index) => ({
          id: item._id,
          rank: index,
        })),
      });
    } catch (error) {
      console.error("Failed to update highlighted content order:", error);
      setFeaturedItems(previousItems);
      toast.error("Highlighted content order was not saved. Try again.");
    } finally {
      setIsOrdering(false);
    }
  };

  const moveFeaturedItem = async (index: number, direction: -1 | 1) => {
    if (readOnly || !featuredItems || isOrdering) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= featuredItems.length) return;

    const previousItems = featuredItems;
    const items = Array.from(featuredItems);
    const [movedItem] = items.splice(index, 1);
    items.splice(nextIndex, 0, movedItem);

    await saveOrder(items, previousItems);
  };

  const currency = activeStore?.currency || "USD";

  return (
    <div className="space-y-layout-lg">
      <FeaturedSectionDialog
        disabled={readOnly}
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
      />
      <div className="space-y-layout-lg">
        <TooltipProvider delayDuration={150}>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="featuredItemsList">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="w-full space-y-layout-sm"
                >
                  {featuredItems?.map((featuredItem, index) => {
                    const product = featuredItem.product;
                    const itemLabel = getFeaturedItemLabel(featuredItem);

                    return (
                      <Draggable
                        key={featuredItem._id}
                        draggableId={featuredItem._id}
                        index={index}
                      >
                        {(provided) => {
                          const {
                            style: draggableStyle,
                            ...draggableProps
                          } = provided.draggableProps;

                          return (
                            <div
                              ref={provided.innerRef}
                              {...draggableProps}
                              style={draggableStyle as CSSProperties | undefined}
                              className="flex flex-col gap-layout-sm rounded-md border border-border bg-background p-layout-sm sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-layout-sm">
                                <span
                                  {...provided.dragHandleProps}
                                  aria-label={`Drag ${itemLabel}`}
                                  className="inline-flex h-10 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  role="button"
                                  tabIndex={0}
                                >
                                  <GripVertical className="h-4 w-4" />
                                </span>
                              {product ? (
                                <Link
                                  to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                                  params={(params) => ({
                                    ...params,
                                    orgUrlSlug: params.orgUrlSlug!,
                                    storeUrlSlug: params.storeUrlSlug!,
                                    productSlug: product._id,
                                  })}
                                  search={{ o: getOrigin() }}
                                  className="flex min-w-0 items-center gap-4"
                                >
                                  <HomepagePlacementProductImage
                                    alt={product.name || "Product"}
                                    product={product}
                                  />
                                  <div className="min-w-0 space-y-1">
                                    <p className="truncate text-sm">
                                      {capitalizeWords(product.name)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {formatStoredCurrencyAmount(
                                        currency,
                                        product.skus[0]?.price ?? 0,
                                        { revealMinorUnits: true },
                                      )}
                                    </p>
                                  </div>
                                </Link>
                              ) : null}

                              {featuredItem?.category && (
                                <div className="min-w-0 space-y-1">
                                  <p className="truncate text-sm">
                                    {featuredItem?.category?.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Category
                                  </p>
                                </div>
                              )}

                              {featuredItem?.subcategory && (
                                <div className="min-w-0 space-y-1">
                                  <p className="truncate text-sm">
                                    {featuredItem?.subcategory?.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Subcategory
                                  </p>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-layout-xs">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label={`Move ${itemLabel} up`}
                                    disabled={readOnly || isOrdering || index === 0}
                                    onClick={() => moveFeaturedItem(index, -1)}
                                    size="icon"
                                    title={`Move ${itemLabel} up`}
                                    variant="ghost"
                                  >
                                    <ArrowUp className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Move up</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label={`Move ${itemLabel} down`}
                                    disabled={
                                      readOnly ||
                                      isOrdering ||
                                      index === (featuredItems?.length ?? 0) - 1
                                    }
                                    onClick={() => moveFeaturedItem(index, 1)}
                                    size="icon"
                                    title={`Move ${itemLabel} down`}
                                    variant="ghost"
                                  >
                                    <ArrowDown className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Move down</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label={`Remove ${itemLabel}`}
                                    disabled={readOnly || isOrdering}
                                    onClick={() =>
                                      handleHighlightedItem(featuredItem)
                                    }
                                    size="icon"
                                    title={`Remove ${itemLabel}`}
                                    variant="ghost"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Remove</TooltipContent>
                              </Tooltip>
                              </div>
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </TooltipProvider>
        <Button
          variant="outline"
          disabled={isOrdering}
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="w-3 h-3 mr-2" />
          <p className="text-xs">Add highlighted item</p>
        </Button>
      </div>
    </div>
  );
};

function getFeaturedItemLabel(item: FeaturedHomepageItem) {
  if (item.product) return capitalizeWords(item.product.name);
  if (item.category) return item.category.name;
  if (item.subcategory) return item.subcategory.name;

  return "highlighted item";
}
