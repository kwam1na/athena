import View from "../View";
import { FadeIn } from "../common/FadeIn";
import Products from "./Products";

export default function CategoryListView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <Products />
      </FadeIn>
    </View>
  );
}
