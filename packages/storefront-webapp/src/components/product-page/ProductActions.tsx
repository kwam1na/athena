import { SavedBagItem } from "@athena/webapp";
import { AlertCircleIcon, HeartIcon } from "lucide-react";

import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { cn } from "@/lib/utils";
import { LoadingButton } from "../ui/loading-button";

interface ProductActionsProps {
  handleUpdateBag: () => Promise<void>;
  handleUpdateSavedBag: () => Promise<void>;
  isUpdatingBag: boolean;
  savedBagItem?: SavedBagItem;
  isSoldOut: boolean;
  addedItemSuccessfully: boolean | null;
  className?: string;
  layout?: "default" | "mobile";
}

export function ProductActions({
  handleUpdateBag,
  handleUpdateSavedBag,
  isUpdatingBag,
  savedBagItem,
  isSoldOut,
  addedItemSuccessfully,
  className,
  layout = "default",
}: ProductActionsProps) {
  return (
    <div className={cn("space-y-layout-sm", className)}>
      <div className="flex gap-layout-sm">
        <LoadingButton
          aria-label={isUpdatingBag ? "Adding to bag" : undefined}
          className="min-w-0 flex-1"
          data-testid="storefront-product-add-to-bag"
          disabled={isSoldOut}
          isLoading={isUpdatingBag}
          loadingLabel="Adding to bag"
          onClick={handleUpdateBag}
        >
          Add to bag
        </LoadingButton>

        <LoadingButton
          aria-label={savedBagItem ? "Remove saved product" : "Save product"}
          className={cn(
            "shrink-0",
            layout === "mobile" ? "w-14 px-0" : "px-layout-md",
            savedBagItem &&
              "border-selection-foreground bg-selection text-selection-foreground shadow-surface",
          )}
          disabled={isSoldOut || isUpdatingBag}
          isLoading={false}
          onClick={handleUpdateSavedBag}
          type="button"
          variant="outline"
        >
          {!savedBagItem ? (
            <HeartIcon aria-hidden="true" className="h-5 w-5" />
          ) : (
            <HeartIconFilled width={18} height={18} />
          )}
        </LoadingButton>
      </div>

      {addedItemSuccessfully === false && (
        <div
          className="flex items-center gap-layout-2xs text-danger"
          role="alert"
        >
          <AlertCircleIcon aria-hidden="true" className="h-4 w-4" />
          <p className="text-sm">
            We couldn't update your bag. Try again.
          </p>
        </div>
      )}
    </div>
  );
}
