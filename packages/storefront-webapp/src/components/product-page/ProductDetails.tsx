import { ProductSku } from "@athena/webapp";
import { SheetTrigger } from "@/components/ui/sheet";
import { getProductName } from "@/lib/productUtils";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import placeholder from "@/assets/placeholder.png";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";
import { ShoppingBagAction } from "@/hooks/useShoppingBag";
import { useStoreContext } from "@/contexts/StoreContext";

// Product Details Section
export function PickupDetails({
  showShippingPolicy,
}: {
  showShippingPolicy: () => void;
}) {
  return (
    <div className="text-sm space-y-8">
      <div className="space-y-4">
        <p className="font-medium">Free store pickup</p>
        <div className="flex gap-4">
          <p>Wigclub Hair Studio</p>
          <a
            href={WIGLUB_HAIR_STUDIO_LOCATION_URL}
            target="_blank"
            className="font-medium underline"
          >
            Get directions
          </a>
        </div>
      </div>
      <SheetTrigger asChild onClick={showShippingPolicy}>
        <p className="font-medium cursor-pointer">
          Deliveries, returns, and exchanges
        </p>
      </SheetTrigger>
    </div>
  );
}

// Bag Product Summary
export function BagProduct({
  product,
  action,
}: {
  product: ProductSku;
  action: ShoppingBagAction;
}) {
  const actionText =
    action == "adding-to-bag"
      ? "Added to your bag"
      : "Added to your saved items";

  const buttonText = action == "adding-to-bag" ? "See Bag" : "See Saved Items";

  const buttonLink = action == "adding-to-bag" ? "/shop/bag" : "/shop/saved";

  const { store } = useStoreContext();

  return (
    <div className="flex flex-col gap-12 pt-12">
      <div className="space-y-8">
        <p className="text-md">{actionText}</p>
        <div className="flex gap-4">
          <img
            alt={`Bag image`}
            className="w-[140px] h-[180px] aspect-square object-cover rounded"
            src={
              product.images[0] ||
              store?.config?.ui?.fallbackImageUrl ||
              placeholder
            }
          />
          <p className="text-sm">{getProductName(product)}</p>
        </div>
      </div>
      <Link to={buttonLink}>
        <Button variant="outline" className="w-full">
          {buttonText}
        </Button>
      </Link>
    </div>
  );
}

export function ShippingPolicy() {
  return (
    <div className="space-y-12 pt-12" aria-describedby="shipping policy">
      <div className="space-y-4">
        <p className="text-md">Deliveries</p>
        <p className="text-sm text-muted-foreground">
          Orders take 24 - 48 hours to process. You will receive an email when
          your order has been dispatched.
        </p>
      </div>
      <div className="space-y-4">
        <p className="text-md">Returns and exchanges</p>
        <p className="text-sm text-muted-foreground">
          You have 7 days from the date your order is received to return your
          purchase.
        </p>
      </div>
    </div>
  );
}
