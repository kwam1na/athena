import { isFeeWaived } from "@/lib/feeUtils";
import { DeliveryMethod, DeliveryOption } from "./types";

type DeliveryFeeConfig = {
  withinAccra?: number;
  otherRegions?: number;
  international?: number;
} | null;

type WaiveDeliveryFees =
  | boolean
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
    }
  | null
  | undefined;

type CalculateDeliveryFeeInput = {
  deliveryMethod: DeliveryMethod;
  country: string;
  region: string | null;
  waiveDeliveryFees: WaiveDeliveryFees;
  deliveryFees: DeliveryFeeConfig;
};

type CalculateDeliveryFeeResult = {
  deliveryFee: number;
  deliveryOption: DeliveryOption | null;
};

export const DEFAULT_WITHIN_ACCRA_FEE = 30;
export const DEFAULT_OTHER_REGIONS_FEE = 70;
export const DEFAULT_INTERNATIONAL_FEE = 800;

export function calculateDeliveryFee({
  deliveryMethod,
  country,
  region,
  waiveDeliveryFees,
  deliveryFees,
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
    baseFee = isGreaterAccra
      ? DEFAULT_WITHIN_ACCRA_FEE
      : DEFAULT_OTHER_REGIONS_FEE;
  } else {
    deliveryOption = "intl";
    baseFee = deliveryFees?.international || DEFAULT_INTERNATIONAL_FEE;
  }

  const shouldWaive = isGhana
    ? typeof waiveDeliveryFees === "boolean"
      ? waiveDeliveryFees
      : isGreaterAccra
        ? waiveDeliveryFees?.withinAccra || waiveDeliveryFees?.all || false
        : waiveDeliveryFees?.otherRegions || waiveDeliveryFees?.all || false
    : isFeeWaived(waiveDeliveryFees, "intl");

  return {
    deliveryFee: shouldWaive ? 0 : baseFee,
    deliveryOption,
  };
}
