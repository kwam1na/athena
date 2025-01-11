import { useQuery } from "convex/react";
import Products from "./Products";
import View from "./View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";

export default function ProductsView() {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || !products) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-sm">Products</p>
        </div>
      </div>
    );
  };

  const hasProducts = products.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasProducts && <Navigation />}
    >
      <Products store={activeStore} products={products} />
    </View>
  );
}
