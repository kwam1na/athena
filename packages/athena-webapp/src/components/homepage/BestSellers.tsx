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
import { BestSellersDialog } from "./BestSellersDialog";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { TrashIcon } from "@radix-ui/react-icons";
import { PlusIcon } from "lucide-react";

export const BestSellers = () => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { activeStore } = useGetActiveStore();

  const bestSellersQuery = useQuery(
    api.inventory.bestSeller.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const [bestSellers, setBestSellers] = useState<any[] | null>(null);

  useEffect(() => {
    if (
      (bestSellersQuery && !bestSellers) ||
      bestSellersQuery?.length !== bestSellers?.length
    ) {
      const bestSellersSorted = bestSellersQuery.sort(
        (a: any, b: any) => a.rank - b.rank
      );
      setBestSellers(bestSellersSorted);
    }
  }, [bestSellersQuery, bestSellers]);

  const formatter = currencyFormatter(activeStore?.currency || "USD");

  const removeBestSeller = useMutation(api.inventory.bestSeller.remove);

  const updateRanks = useMutation(api.inventory.bestSeller.updateRanks);

  const handleRemoveBestSeller = async (bestSeller: any) => {
    removeBestSeller({
      id: bestSeller._id,
    });
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !bestSellers) return;

    const items = Array.from(bestSellers);
    const [movedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, movedItem);

    setBestSellers(items);

    const newRanks = items.map((item: any, index) => ({
      id: item._id,
      rank: index,
    }));

    updateRanks({ ranks: newRanks });
  };

  return (
    <View
      className="p-8"
      header={<p className="text-sm text-muted-foreground">Best sellers</p>}
    >
      <BestSellersDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
      />
      <div className="space-y-8 p-8">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="bestSellersList">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="w-full space-y-8"
              >
                {bestSellers?.map((bestSeller: any, index: number) => (
                  <Draggable
                    key={bestSeller._id}
                    draggableId={bestSeller._id}
                    index={index}
                  >
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className="flex items-center justify-between bg-white"
                      >
                        <Link
                          to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                          params={(params) => ({
                            ...params,
                            orgUrlSlug: params.orgUrlSlug!,
                            storeUrlSlug: params.storeUrlSlug!,
                            productSlug: bestSeller?.product?._id,
                          })}
                          className="flex items-center gap-4"
                        >
                          <img
                            src={bestSeller?.product?.skus[0]?.images[0]}
                            alt={bestSeller?.product?.name}
                            className="w-16 h-16 rounded-md object-cover"
                          />
                          <div className="flex flex-col gap-2">
                            <p className="text-sm">
                              {bestSeller?.product?.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatter.format(
                                bestSeller?.product?.skus[0]?.price
                              )}
                            </p>
                          </div>
                        </Link>

                        <Button
                          variant="ghost"
                          onClick={() => handleRemoveBestSeller(bestSeller)}
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
          <p className="text-xs">Add product</p>
        </Button>
      </div>
    </View>
  );
};