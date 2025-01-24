import { getErrorForField } from "@/lib/utils";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import View from "../View";
import { Skeleton } from "../ui/skeleton";
import { useProduct } from "@/contexts/ProductContext";

export function ProductDetailsView() {
  const id = "productName";

  const { productData, isLoading, updateProductData, error } = useProduct();

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateProductData({ name: e.target.value });
  };

  const validationError = getErrorForField(error, id);

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={<p className="text-sm text-sm font-medium">Details</p>}
    >
      <div className="px-4 py-8 space-y-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground" htmlFor="name">
            Name
          </Label>
          {isLoading && <Skeleton className="h-[40px]" />}
          {!isLoading && (
            <Input value={productData.name || ""} onChange={handleNameChange} />
          )}
          {validationError && (
            <p className="text-red-500 text-sm font-medium">
              {validationError.message}
            </p>
          )}
        </div>
        {/* <div className="space-y-2">
          <Label className="text-muted-foreground" htmlFor="description">
            Description
          </Label>
          {isLoading && <Skeleton className="h-[96px] w-full" />}
          {!isLoading && <Textarea />}
        </div> */}
      </div>
    </View>
  );
}
