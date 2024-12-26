import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import View from "../View";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { ALL_COUNTRIES } from "~/src/lib/countries";
import { GHANA_REGIONS } from "~/src/lib/ghanaRegions";

export function PickupDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  // console.log(order);

  const formatter = currencyFormatter(activeStore.currency);

  const { deliveryDetails, deliveryMethod } = order;

  if (deliveryMethod == "pickup") {
    return (
      <View
        className="h-auto w-full"
        header={
          <p className="text-sm text-sm text-muted-foreground">Store pickup</p>
        }
      >
        <div className="p-8 flex gap-32">
          <div className="space-y-4">
            <div className="text-sm space-y-2">
              <p>{activeStore.name}</p>
              <p className="text-muted-foreground">{order.pickupLocation}</p>
            </div>
          </div>
        </div>
      </View>
    );
  }

  return (
    <View
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Delivery</p>}
    >
      <div className="p-8 flex gap-32">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Address</p>
          <DeliveryDetails address={deliveryDetails} />
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Fee</p>
          <p className="text-sm">{formatter.format(order.deliveryFee || 0)}</p>
        </div>
      </div>
    </View>
  );
}

const DeliveryDetails = ({ address }: { address: any }) => {
  const country = ALL_COUNTRIES.find((c) => c.code == address.country)?.name;

  const region = GHANA_REGIONS.find((r) => r.code == address.region)?.name;

  const isUSOrder = address.country === "US";

  return (
    <div className="space-y-2 text-sm">
      {isUSOrder && (
        <p>{`${address.address}, ${address.city}, ${address.state}, ${address.zip}`}</p>
      )}
      {!isUSOrder && <p>{`${address.address}, ${address.city}`}</p>}
      {region && <p>{`${region}`}</p>}
      <p>{country}</p>
    </div>
  );
};
