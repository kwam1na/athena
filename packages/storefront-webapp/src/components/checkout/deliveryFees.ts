import { isFeeWaived } from "@/lib/feeUtils";
import { DeliveryMethod, DeliveryOption } from "./types";

type DeliveryFeeConfig = {
  withinAccra?: number;
  otherRegions?: number;
  international?: number;
} | null;

type WaiveDeliveryFees =
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
      minimumOrderAmount?: number;
    }
  | null
  | undefined;

type CalculateDeliveryFeeInput = {
  deliveryMethod: DeliveryMethod;
  country: string;
  region: string | null;
  waiveDeliveryFees: WaiveDeliveryFees;
  deliveryFees: DeliveryFeeConfig;
  subtotal?: number; // in pesewas
};

type CalculateDeliveryFeeResult = {
  deliveryFee: number; // in pesewas
  deliveryOption: DeliveryOption | null;
};

// Default fees in pesewas
const DEFAULT_WITHIN_ACCRA_FEE = 3000;
const DEFAULT_OTHER_REGIONS_FEE = 7000;
const DEFAULT_INTERNATIONAL_FEE = 80000;

export function calculateDeliveryFee({
  deliveryMethod,
  country,
  region,
  waiveDeliveryFees,
  deliveryFees,
  subtotal,
}: CalculateDeliveryFeeInput): CalculateDeliveryFeeResult {
  if (deliveryMethod === "pickup") {
    return { deliveryFee: 0, deliveryOption: null };
  }

  const isGhana = country === "GH";
  const isGreaterAccra = region === "GA";

  let deliveryOption: DeliveryOption;
  let baseFee: number;

  if (isGhana) {
    deliveryOption = isGreaterAccra ? "within-accra" : "outside-accra";
    const withinAccraFee =
      deliveryFees?.withinAccra ?? DEFAULT_WITHIN_ACCRA_FEE;
    const otherRegionsFee =
      deliveryFees?.otherRegions ?? DEFAULT_OTHER_REGIONS_FEE;
    baseFee = isGreaterAccra
      ? withinAccraFee
      : otherRegionsFee;
  } else {
    deliveryOption = "intl";
    baseFee = deliveryFees?.international ?? DEFAULT_INTERNATIONAL_FEE;
  }

  const shouldWaive = isFeeWaived(waiveDeliveryFees, deliveryOption, subtotal);

  return {
    deliveryFee: shouldWaive ? 0 : baseFee,
    deliveryOption,
  };
}
