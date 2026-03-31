import { isFeeWaived } from "@/lib/feeUtils";
import { toPesewas } from "@/lib/currency";
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

const DEFAULT_WITHIN_ACCRA_FEE = 30;
const DEFAULT_OTHER_REGIONS_FEE = 70;
const DEFAULT_INTERNATIONAL_FEE = 800;

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

  const shouldWaive = isGhana
    ? typeof waiveDeliveryFees === "boolean"
      ? waiveDeliveryFees
      : isGreaterAccra
        ? waiveDeliveryFees?.withinAccra || waiveDeliveryFees?.all || false
        : waiveDeliveryFees?.otherRegions || waiveDeliveryFees?.all || false
    : isFeeWaived(waiveDeliveryFees, "intl");

  return {
    deliveryFee: shouldWaive ? 0 : toPesewas(baseFee),
    deliveryOption,
  };
}
