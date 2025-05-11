import { CheckoutSession } from "@athena/webapp";
import { DeliveryDetails } from "../DeliveryDetails/DeliverySection";
import { getDiscountValue, getOrderAmount } from "../utils";
import { useStoreContext } from "@/contexts/StoreContext";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Award } from "lucide-react";

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

  const { paymentMethod, discount } = session;

  const amountCharge = getOrderAmount({
    discount,
    deliveryFee: session.deliveryFee,
    subtotal: session.amount,
  });

  const discountValue = getDiscountValue(session.amount, discount);

  const text =
    paymentMethod?.channel == "mobile_money"
      ? `${paymentMethod?.bank} Mobile Money ending in ${paymentMethod?.last4}`
      : `Card ending in ${paymentMethod?.last4}`;

  const discountText =
    discount?.type === "percentage"
      ? `${discount.value}%`
      : `${formatter.format(discountValue)}`;

  const potentialRewards = Math.floor(session.amount / 1000);

  return (
    <div className="space-y-8">
      <p className="text-xs">Payment</p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm">{formatter.format(amountCharge / 100)}</p>
          {discount && (
            <p className="text-sm font-medium">
              {`${discount?.code} - ${discountText}`} off entire order
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
