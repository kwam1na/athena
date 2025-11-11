import View from "../View";
import { FadeIn } from "../common/FadeIn";
import Products from "./Products";

const Navigation = () => {
  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xl font-medium">Products</p>
      </div>
    </div>
  );
};

export default function CategoryListView() {
  return (
    <View hideBorder hideHeaderBottomBorder header={<Navigation />}>
      <FadeIn className="py-16">
        <Products />
      </FadeIn>
    </View>
  );
}
