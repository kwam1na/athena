import StoreProducts from "./StoreProducts";
import View from "./View";
import { useGetProducts } from "../hooks/useGetProducts";

export default function StoreProductsView() {
  const products = useGetProducts();

  if (!products) return null;

  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
        <div className="flex items-center">
          <p className="text-3xl font-medium">Products</p>
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
      <StoreProducts products={products} />
    </View>
  );
}
