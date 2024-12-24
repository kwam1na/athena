import { DeliveryDetails } from "../DeliveryDetails/DeliverySection";

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

export const PaymentDetails = ({ session }: { session: any }) => {
  if (!session?.paymentMethod) {
    return null;
  }

  const { paymentMethod } = session;

  const text =
    paymentMethod?.channel == "mobile_money"
      ? `${paymentMethod?.bank} Mobile Money ending in ${paymentMethod?.last4}`
      : `Card ending in ${paymentMethod?.last4}`;

  return (
    <div className="space-y-8">
      <p className="text-xs">Payment</p>

      <p className="text-sm">{text}</p>
    </div>
  );
};
