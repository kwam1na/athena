import { Id } from "../_generated/dataModel";

/**
 * Result of a payment transaction operation
 */
export type PaymentResult = {
  success: boolean;
  message: string;
  reference?: string;
  data?: any;
};

/**
 * Result of payment verification
 */
export type PaymentVerificationResult = {
  verified: boolean;
  message?: string;
};

/**
 * Standardized order item format
 */
export type OrderItem = {
  productSkuId: Id<"productSku">;
  quantity: number;
  price: number;
};

/**
 * Paystack transaction initialization response
 */
export type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

/**
 * Paystack transaction verification response
 */
export type PaystackVerificationResponse = {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: any;
    fees: number;
    customer: {
      id: number;
      email: string;
      customer_code: string;
    };
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
  };
};

/**
 * Paystack refund response
 */
export type PaystackRefundResponse = {
  status: boolean;
  message: string;
  data?: {
    transaction?: {
      reference: string;
    };
  };
};

/**
 * Payment method details for POD orders
 */
export type PaymentMethodDetails = {
  type: "payment_on_delivery" | "online_payment";
  podPaymentMethod?: "cash" | "mobile_money";
  channel: string;
};
