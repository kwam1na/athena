import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import View from "../View";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { ALL_COUNTRIES } from "~/src/lib/countries";
import { GHANA_REGIONS } from "~/src/lib/ghanaRegions";
import { accraNeighborhoods, ghanaRegions } from "~/src/lib/ghana";

export function PickupDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const { deliveryDetails, deliveryMethod } = order;

  const { location } = activeStore?.config?.contactInfo || {};

  if (deliveryMethod == "pickup") {
    return (
      <View
        hideBorder
        hideHeaderBottomBorder
        className="h-auto w-full"
        header={
          <p className="text-sm text-sm text-muted-foreground">Store pickup</p>
        }
      >
        <div className="py-4 flex gap-32">
          <div className="space-y-4">
            <div className="text-sm space-y-2">
              <p>{activeStore.name}</p>
              <p className="text-muted-foreground">{location}</p>
            </div>
          </div>
        </div>
      </View>
    );
  }

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Delivery</p>}
    >
      <div className="py-4 space-y-8">
        <div className="flex gap-32">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Address</p>
            <DeliveryDetails address={deliveryDetails} />
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Instructions</p>
          <p className="text-sm">{order.deliveryInstructions || "None"}</p>
        </div>
      </div>
    </View>
  );
}

const DeliveryDetails = ({ address }: { address: any }) => {
  const country = ALL_COUNTRIES.find((c) => c.code == address.country)?.name;

  const isUSOrder = address.country === "US";

  const isGhanaOrder = address.country === "GH";

  const isROWOrder = !isUSOrder && !isGhanaOrder;

  const region = ghanaRegions.find((r) => r.code == address.region)?.name;

  const neighborhood =
    accraNeighborhoods.find((n) => n.value == address.neighborhood)?.label ||
    address?.neighborhood;

  return (
    <div className="space-y-2 text-sm">
      <p>{address.address}</p>
      {isUSOrder && (
        <p>{`${address.city}, ${address.state}, ${address.zip}`}</p>
      )}
      {isROWOrder && <p>{`${address.city}`}</p>}

      {isGhanaOrder && (
        <p>{`${address.houseNumber || ""} ${address.street}, ${neighborhood}, ${region}`}</p>
      )}
      <p>{address?.landmark}</p>
      <p>{country}</p>
    </div>
  );
};
