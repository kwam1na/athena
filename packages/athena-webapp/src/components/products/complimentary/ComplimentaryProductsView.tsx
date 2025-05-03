import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import ComplimentaryProducts from "@/components/products/complimentary/ComplimentaryProducts";
import { useGetComplimentaryProducts } from "@/hooks/useGetComplimentaryProducts";

const Navigation = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px]">
      <div className="flex items-center">
        <p className="text-xl font-medium">Complimentary Products</p>
      </div>
    </div>
  );
};

function Body() {
  const products = useGetComplimentaryProducts();

  if (!products) return null;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={products.length > 0 && <Navigation />}
    >
      <FadeIn>
        <ComplimentaryProducts products={products} />
      </FadeIn>
    </View>
  );
}

export default function ComplimentaryProductsView() {
  return <Body />;
}
