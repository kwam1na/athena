import { CheckoutSession, OnlineOrder } from "@athena/webapp";

export type Address = {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
  region?: string;
  street?: string;
  houseNumber?: string;
  neighborhood?: string;
  landmark?: string;
};

export type BillingAddress = Address & {
  billingAddressSameAsDelivery?: boolean;
};

export type CustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
};

export type DeliveryOption = "within-accra" | "outside-accra" | "intl";

export type DeliveryMethod = "delivery" | "pickup";

export type Discount = {
  id: string;
  code: string;
  type: "percentage" | "amount";
  value: number;
  span: "entire-order" | "selected-products";
  isMultipleUses: boolean;
  productSkus?: string[];
  totalDiscount?: number;
};

export type PaymentMethodType = "online_payment" | "payment_on_delivery";
export type PODPaymentMethod = "cash" | "mobile_money";

export type CheckoutState = {
  billingDetails: BillingAddress | null;
  customerDetails: CustomerDetails | null;
  deliveryMethod: DeliveryMethod | null;
  deliveryOption: DeliveryOption | null;
  deliveryFee: number | null;
  deliveryDetails: Address | null;
  deliveryInstructions: string;
  pickupLocation: string | null;

  didEnterDeliveryDetails: boolean;
  didSelectPickupLocation: boolean;
  didEnterBillingDetails: boolean;

  isUSOrder: boolean;
  isGhanaOrder: boolean;
  isROWOrder: boolean;
  isPickupOrder: boolean;
  isDeliveryOrder: boolean;

  failedFinalValidation: boolean;

  bag: any;

  discount: Discount | null;

  onlineOrder: OnlineOrder | null;

  // Payment method fields
  paymentMethod: PaymentMethodType | null;
  podPaymentMethod: PODPaymentMethod | null;
};

export type CheckoutActions = {
  isEditingCustomerDetails: boolean;
  isEditingDeliveryDetails: boolean;
  isEditingBillingDetails: boolean;
  didEnterDeliveryDetails: boolean;
  didEnterBillingDetails: boolean;
  didToggleOrderSummary: boolean;
};

export type CheckoutContextType = {
  activeSession: CheckoutSession;
  onlineOrder: OnlineOrder | null;
  actionsState: CheckoutActions;
  checkoutState: CheckoutState;
  canPlaceOrder: () => Promise<boolean>;
  updateState: (newState: Partial<CheckoutState>) => void;
  updateActionsState: (newState: Partial<CheckoutActions>) => void;
};
