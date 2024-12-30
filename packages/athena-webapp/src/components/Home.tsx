import { PlusIcon } from "lucide-react";
import { Button } from "./ui/button";
import View from "./View";

import {
  Calculator,
  Calendar,
  CreditCard,
  Settings,
  Smile,
  User,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useEffect, useState } from "react";
import useGetActiveStore from "../hooks/useGetActiveStore";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function CommandDialogDemo({
  dialogOpen,
  setDialogOpen,
}: {
  dialogOpen: boolean;
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setDialogOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  const addBestSeller = useMutation(api.inventory.bestSeller.create);

  const handleAddBestSeller = async (product: any) => {
    console.log("adding best seller...", activeStore);

    if (!activeStore) return;

    console.log("adding best seller...");

    addBestSeller({
      productId: product._id,
      storeId: activeStore._id,
    });

    setDialogOpen(false);
  };

  if (!activeStore || !products) return null;

  return (
    <>
      <CommandDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <CommandList>
          <CommandGroup heading="Products">
            {products?.map((product: any) => (
              <CommandItem key={product._id}>
                <div
                  className="flex items-center gap-2"
                  onClick={() => handleAddBestSeller(product)}
                >
                  <img
                    src={product?.skus[0].images[0]}
                    alt={product?.name}
                    className="w-8 h-8 rounded-md"
                  />
                  <p>{product.name}</p>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

const BestSellers = () => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { activeStore } = useGetActiveStore();

  const bestSellers = useQuery(
    api.inventory.bestSeller.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  console.log("bestSellers", bestSellers);

  return (
    <View
      className="p-8"
      header={
        <p className="text-sm text-sm text-muted-foreground">Best sellers</p>
      }
    >
      <CommandDialogDemo
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
      />
      <div className="p-8 w-full">
        <div className="flex flex-col items-center justify-center gap-4">
          {bestSellers?.map((bestSeller: any) => (
            <div key={bestSeller._id} className="flex items-center gap-4">
              {/* <img
                src={bestSeller.product.skus[0].images[0]}
                alt={bestSeller.product.name}
                className="w-16 h-16 rounded-md"
              />
              <div className="flex flex-col gap-2">
                <p className="font-medium">{bestSeller.product.name}</p>
                <p className="text-muted-foreground">
                  {bestSeller.product.skus[0].price}
                </p>
              </div> */}
            </div>
          ))}
          <Button variant={"ghost"} onClick={() => setDialogOpen(true)}>
            <PlusIcon className="w-3 h-3 mr-2" />
            <p className="text-xs">Add product</p>
          </Button>
        </div>
      </div>
    </View>
  );
};

export default function Home() {
  const Navigation = () => {
    return <div className="flex gap-2 h-[40px]"></div>;
  };

  return (
    <View className="p-8" header={<Navigation />}>
      <BestSellers />
    </View>
  );
}
