import { useStoreContext } from "@/contexts/StoreContext";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getProductName } from "@/lib/productUtils";
import { ProductSku } from "@athena/webapp-2";
import { useCheckout } from "./CheckoutProvider";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import placeholder from "@/assets/placeholder.png";
import { motion } from "framer-motion";

function SummaryItem({
  item,
  formatter,
}: {
  item: ProductSku;
  formatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="h-12 w-12 rounded-lg overflow-hidden">
          <img
            src={item.productImage || placeholder}
            alt={item.productName || "product image"}
            className="aspect-square object-cover rounded-lg"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-sm text-muted-foreground">
            {formatter.format(item.price * item.quantity)}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{`x${item.quantity}`}</p>
    </div>
  );
}

export function BagSummaryItems() {
  const { formatter } = useStoreContext();
  const { bag } = useShoppingBag();

  return (
    <div className="space-y-12 w-full">
      {bag?.items.map((item: ProductSku, index: number) => (
        <SummaryItem formatter={formatter} item={item} key={index} />
      ))}
    </div>
  );
}

function BagSummary() {
  const { formatter } = useStoreContext();
  const { bag, bagSubtotal } = useShoppingBag();
  const { checkoutState } = useCheckout();

  const total = checkoutState.deliveryFee + bagSubtotal;

  return (
    <motion.div className="py-6 bg-white shadow-sm w-[80vw] lg:w-[30vw] space-y-12">
      {/* Order Summary */}
      <div className="flex items-center px-6 w-full">
        <p>Order summary</p>
        <div className="ml-auto">
          <Link to="/shop/bag">
            <Button variant={"clear"}>
              <p>Update bag</p>
            </Button>
          </Link>
        </div>
      </div>

      {/* Items */}
      <div className="px-8 space-y-12 my-4 w-full">
        {bag?.items.map((item: ProductSku, index: number) => (
          <SummaryItem formatter={formatter} item={item} key={index} />
        ))}
      </div>

      {/* Promo Code */}
      {/* <div className="px-8 space-y-2">
        <p className="text-sm font-medium">Promo code</p>
        <div>
          <Input type="text" placeholder="Enter promo code" />
        </div>
      </div> */}

      <Separator className="bg-[#F6F6F6]" />

      {/* Summary */}
      <div className="px-8 space-y-8 pt-4 mt-4">
        <div className="flex justify-between">
          <p className="text-sm">Subtotal</p>
          <p className="text-sm">{formatter.format(bagSubtotal)}</p>
        </div>
        {checkoutState.deliveryFee && (
          <div className="flex justify-between">
            <p className="text-sm">Shipping</p>
            <p className="text-sm">
              {formatter.format(checkoutState.deliveryFee)}
            </p>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <p className="text-lg">Total</p>
          <p className="text-lg">{formatter.format(total)}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default BagSummary;
