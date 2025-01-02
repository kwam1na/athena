import { ProductSku } from "@athena/webapp-2";
import { SheetTrigger } from "../ui/sheet";
import { getProductName } from "@/lib/productUtils";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import placeholder from "@/assets/placeholder.png";
import { WIGLUB_HAIR_STUDIO_LOCATION_URL } from "@/lib/constants";

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
          Shipping, returns, and exchanges
        </p>
      </SheetTrigger>
    </div>
  );
}

// Bag Product Summary
export function BagProduct({ product }: { product: ProductSku }) {
  return (
    <div className="flex flex-col gap-12 pt-12">
      <div className="space-y-8">
        <p className="text-md">Added to your bag</p>
        <div className="flex gap-4">
          <img
            alt={`Bag image`}
            className="w-[140px] h-[180px] aspect-square object-cover rounded"
            src={product.images[0] || placeholder}
          />
          <p className="text-sm">{getProductName(product)}</p>
        </div>
      </div>
      <Link to="/shop/bag">
        <Button variant="outline" className="w-full">
          See Bag
        </Button>
      </Link>
    </div>
  );
}

export function ShippingPolicy() {
  return (
    <div className="space-y-12 pt-12">
      <div className="space-y-4">
        <p className="text-md">Shipping</p>
        <p className="text-sm text-muted-foreground">
          Orders take 24 - 48 hours to process. You will receive an email when
          your order has been shipped.
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
