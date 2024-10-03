import View from "../View";
import ProductAttributes from "./ProductAttributes";

export function ProductAttributesView() {
  return (
    <View
      className="h-auto"
      header={
        <p className="text-sm text-sm text-muted-foreground">Attributes</p>
      }
    >
      <ProductAttributes />
    </View>
  );
}
