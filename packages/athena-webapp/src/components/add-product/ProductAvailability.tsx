import { Label } from "../ui/label";
import View from "../View";
import ProductAvailabilityToggleGroup from "./ProductAvailabilityToggleGroup";

export function ProductAvailabilityView() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={
        <p className="text-sm text-sm text-muted-foreground">Availability</p>
      }
    >
      <ProductAvailability />
    </View>
  );
}

function ProductAvailability() {
  const id = "availability";

  return (
    <div className="grid gap-6 px-4 py-8">
      <div className="grid gap-3">
        <Label className="text-muted-foreground" htmlFor="status">
          Status
        </Label>

        <ProductAvailabilityToggleGroup />
      </div>
    </div>
  );
}
