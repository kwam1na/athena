import { CheckoutSession } from "@athena/webapp";
import { DeliveryDetails } from "../DeliveryDetails/DeliverySection";
import { getDiscountValue, getOrderAmount } from "../utils";
import { useStoreContext } from "@/contexts/StoreContext";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Award } from "lucide-react";
import { useCheckout } from "../CheckoutProvider";

export const PickupDetails = ({ session }: { session: any }) => {
  if (session.deliveryMethod == "pickup") {
    return (
      <div className="space-y-8 text-sm">
        <p className="text-xs">Picking up at</p>

        <div className="space-y-2">
          <p className="">Wigclub Hair Studio</p>
          <p className="text-sm text-muted-foreground">
            2 Jungle Ave., East Legon
          </p>
        </div>
      </div>
    );
  }

  if (!session.deliveryDetails) return null;

  return (
    <div className="space-y-8">
      <p className="text-xs">Delivering to</p>

      <DeliveryDetails address={session.deliveryDetails} />
    </div>
  );
};

export const PaymentDetails = ({ session }: { session?: CheckoutSession }) => {
  const { userId } = useAuth();

  const isGuest = userId === undefined;

  if (!session?.paymentMethod) {
    return null;
  }

  const { formatter } = useStoreContext();
  const { checkoutState, onlineOrder } = useCheckout();

  const { paymentMethod, discount } = session;

  const itemsToUse = onlineOrder?.items || checkoutState.bag?.items;

  const items =
    itemsToUse?.map((item: any) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price,
    })) || [];

  const amountCharge = getOrderAmount({
    items,
    discount: discount as any,
    deliveryFee: (session.deliveryFee || 0) * 100,
    subtotal: session.amount,
    isInCents: true,
  });

  const discountValue = getDiscountValue(items, discount as any);
  const originalAmount = session.amount + (session.deliveryFee || 0);
  const hasDiscount = discount && discountValue > 0;

  const text =
    paymentMethod?.channel == "mobile_money"
      ? `${paymentMethod?.bank} Mobile Money ending in ${paymentMethod?.last4}`
      : `Card ending in ${paymentMethod?.last4}`;

  const discountText =
    discount?.type === "percentage"
      ? `${discount.value}%`
      : `${formatter.format(discountValue)}`;

  const discountSpan =
    discount?.span == "entire-order" ? "entire order" : "select items";

  const potentialRewards = Math.floor(session.amount / 10);

  return (
    <div className="space-y-8">
      <p className="text-xs">Payment</p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {hasDiscount ? (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground line-through">
                {formatter.format(originalAmount / 100)}
              </p>
              <p className="text-sm font-medium">
                {formatter.format(amountCharge / 100)}
              </p>
            </div>
          ) : (
            <p className="text-sm">{formatter.format(amountCharge / 100)}</p>
          )}
          {discount && (
            <p className="text-sm font-medium">
              {`${discount?.code} - ${discountText}`} off {discountSpan}
            </p>
          )}
        </div>
        <p className="text-sm">{text}</p>

        {!isGuest && (
          <div className="flex items-center gap-2 text-accent2">
            <Award className="w-4 h-4" />
            <p className="text-sm font-medium">
              +{potentialRewards.toLocaleString()} points earned
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export const OrderDetails = ({
  session,
  delayAnimation,
}: {
  session?: CheckoutSession;
  delayAnimation?: boolean;
}) => {
  const transition = delayAnimation
    ? { ease: "easeOut", duration: 0.8, delay: 1.1 }
    : { ease: "easeOut" };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        y: 0,
        transition,
      }}
      className="grid grid-cols-1 lg:grid-cols-2 w-full lg:w-[80%] gap-8"
    >
      <PickupDetails session={session} />

      <PaymentDetails session={session} />
    </motion.div>
  );
};
