import Products from "./Products";
import View from "./View";
import { useLoaderData } from "@tanstack/react-router";
import { Product, Store } from "@athena/db";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useQuery } from "@tanstack/react-query";
import { getAllProducts } from "@/api/product";

export default function ProductsView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  const { activeStore } = useGetActiveStore();

  const { data: products } = useQuery({
    queryKey: ["products", activeStore?.id],
    queryFn: () =>
      getAllProducts({
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
      }),
    enabled: Boolean(activeStore),
  });

  if (!activeStore || !products) return null;

  return (
    <View className="bg-background" header={<Navigation />}>
      <Products store={activeStore} products={products} />
    </View>
  );
}
