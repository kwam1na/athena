import { getErrorForField } from "@/lib/utils";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import View from "../View";
import { Skeleton } from "../ui/skeleton";
import { useProduct } from "@/contexts/ProductContext";

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

  const { error, isLoading, productData, updateProductData } = useProduct();

  // console.log("[availability]:", appState);

  const availabilityValidationError = getErrorForField(error, id);

  return (
    <div className="grid gap-6 px-4 py-8">
      <div className="grid gap-3">
        <Label className="text-muted-foreground" htmlFor="status">
          Status
        </Label>
        {isLoading && <Skeleton className="h-[40px] w-full" />}
        {!isLoading && (
          <Select
            onValueChange={(value: string) => {
              updateProductData({
                availability: value as
                  | "archived"
                  | "draft"
                  | "live"
                  | undefined,
              });
            }}
            defaultValue="draft"
            value={productData.availability}
          >
            <SelectTrigger id="status" aria-label="Select status">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        )}
        {availabilityValidationError && (
          <p className="text-red-500 text-sm font-medium">
            {availabilityValidationError.message}
          </p>
        )}
      </div>
    </div>
  );
}
