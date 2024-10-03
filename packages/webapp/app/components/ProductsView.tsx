import Products from "./Products";
import View from "./View";
import { useLoaderData } from "@tanstack/react-router";
import { Product, Store } from "@athena/db";

export default function ProductsView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  const data: { store: Store; products: Product[] } = useLoaderData({
    from: "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/",
  });

  return (
    <View className="bg-background" header={<Navigation />}>
      <Products store={data.store} products={data.products} />
    </View>
  );
}
