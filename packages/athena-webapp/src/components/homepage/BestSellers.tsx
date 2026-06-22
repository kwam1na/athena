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
import { BestSellersDialog } from "./BestSellersDialog";
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
import { toast } from "sonner";
import { getOrigin } from "~/src/lib/navigationUtils";
import { getProductName } from "~/src/lib/productUtils";
import { formatStoredCurrencyAmount } from "~/src/lib/pos/displayAmounts";
import type { Id } from "~/convex/_generated/dataModel";
import type { ProductSku } from "~/types";

type BestSellerItem = {
  _id: Id<"bestSeller">;
  productId: Id<"product">;
  rank?: number;
  productSku: ProductSku;
};

export const BestSellers = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);

  const { activeStore } = useGetActiveStore();

  const bestSellersQuery = useQuery(
    api.inventory.bestSeller.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as BestSellerItem[] | undefined;

  const [bestSellers, setBestSellers] = useState<BestSellerItem[] | null>(null);

  useEffect(() => {
    if (!bestSellersQuery) {
      return;
    }

    setBestSellers(
      [...bestSellersQuery].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    );
  }, [bestSellersQuery]);

  const currency = activeStore?.currency || "USD";

  const removeBestSeller = useMutation(api.inventory.bestSeller.remove);

  const updateRanks = useMutation(api.inventory.bestSeller.updateRanks);

  const handleRemoveBestSeller = async (bestSeller: BestSellerItem) => {
    try {
      await removeBestSeller({ id: bestSeller._id });
      toast.success("Best seller removed");
    } catch (error) {
      console.error("Failed to remove best seller:", error);
      toast.error("Best seller was not removed. Try again.");
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination || !bestSellers) return;
    if (result.destination.index === result.source.index) return;

    const previousItems = bestSellers;
    const items = Array.from(bestSellers);
    const [movedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, movedItem);

    setBestSellers(items);

    const newRanks = items.map((item, index) => ({
      id: item._id,
      rank: index,
    }));

    setIsOrdering(true);
    try {
      await updateRanks({ ranks: newRanks });
    } catch (error) {
      console.error("Failed to update best seller order:", error);
      setBestSellers(previousItems);
      toast.error("Best seller order was not saved. Try again.");
    } finally {
      setIsOrdering(false);
    }
  };

  const saveOrder = async (
    items: BestSellerItem[],
    previousItems: BestSellerItem[] | null,
  ) => {
    setBestSellers(items);
    setIsOrdering(true);
    try {
      await updateRanks({
        ranks: items.map((item, index) => ({
          id: item._id,
          rank: index,
        })),
      });
    } catch (error) {
      console.error("Failed to update best seller order:", error);
      setBestSellers(previousItems);
      toast.error("Best seller order was not saved. Try again.");
    } finally {
      setIsOrdering(false);
    }
  };

  const moveBestSeller = async (index: number, direction: -1 | 1) => {
    if (!bestSellers || isOrdering) return;

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= bestSellers.length) return;

    const previousItems = bestSellers;
    const items = Array.from(bestSellers);
    const [movedItem] = items.splice(index, 1);
    items.splice(nextIndex, 0, movedItem);

    await saveOrder(items, previousItems);
  };

  return (
    <div className="space-y-layout-lg">
      <BestSellersDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
      />
      <div className="space-y-layout-lg">
        <TooltipProvider delayDuration={150}>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="bestSellersList">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="w-full space-y-layout-sm"
                >
                  {bestSellers?.map((bestSeller, index) => {
                    const itemLabel =
                      getProductName(bestSeller?.productSku) || "best seller";

                    return (
                      <Draggable
                        key={bestSeller._id}
                        draggableId={bestSeller._id}
                        index={index}
                      >
                        {(provided) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
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
                              <Link
                                to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                                params={(params) => ({
                                  ...params,
                                  orgUrlSlug: params.orgUrlSlug!,
                                  storeUrlSlug: params.storeUrlSlug!,
                                  productSlug: bestSeller?.productId,
                                })}
                                search={{
                                  o: getOrigin(),
                                  variant: bestSeller?.productSku?.sku,
                                }}
                                className="flex min-w-0 items-center gap-4"
                              >
                                <img
                                  src={bestSeller?.productSku?.images[0]}
                                  alt={bestSeller?.productSku?.productName}
                                  className="h-16 w-16 shrink-0 rounded-md object-cover"
                                />
                                <div className="min-w-0 space-y-1">
                                  <p className="truncate text-sm">
                                    {itemLabel}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatStoredCurrencyAmount(
                                      currency,
                                      bestSeller.productSku.price,
                                      { revealMinorUnits: true },
                                    )}
                                  </p>
                                </div>
                              </Link>
                            </div>

                            <div className="flex items-center justify-end gap-layout-xs">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label={`Move ${itemLabel} up`}
                                    disabled={isOrdering || index === 0}
                                    onClick={() => moveBestSeller(index, -1)}
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
                                      isOrdering ||
                                      index === (bestSellers?.length ?? 0) - 1
                                    }
                                    onClick={() => moveBestSeller(index, 1)}
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
                                    disabled={isOrdering}
                                    onClick={() =>
                                      handleRemoveBestSeller(bestSeller)
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
                        )}
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
          <p className="text-xs">Add product</p>
        </Button>
      </div>
    </div>
  );
};
