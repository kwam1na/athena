import { PAYMENT_CONSTANTS, TEST_ACCOUNTS } from "../constants/payment";
import { sendNewOrderEmail, sendOrderEmail } from "../mailersend";
import { Address } from "../../types";
import { currencyFormatter, formatDate, getAddressString } from "../utils";
import { formatOrderItems } from "../storeFront/onlineOrderUtilFns";
import { Id } from "../_generated/dataModel";
import { getDiscountValue } from "../inventory/utils";

type OrderDetails = {
  _id: Id<"onlineOrder">;
  _creationTime: number;
  orderNumber: string;
  customerDetails: {
    email: string;
    firstName: string;
    lastName: string;
  };
  deliveryMethod: string;
  deliveryDetails: any;
  deliveryFee?: number | null;
  discount?: any;
  items?: any[];
  storeId: Id<"store">;
  didSendNewOrderReceivedEmail?: boolean;
  didSendConfirmationEmail?: boolean;
};

type StoreDetails = {
  currency?: string;
  config?: {
    contactInfo?: {
      location?: string;
    };
  };
};

/**
 * Check if customer email is a test account
 */
export function shouldSendToAdmins(customerEmail: string): boolean {
  return !TEST_ACCOUNTS.includes(customerEmail);
}

/**
 * Build order status messaging based on delivery method and payment type
 */
export function buildOrderStatusMessage(params: {
  deliveryMethod: string;
  isPaymentOnDelivery?: boolean;
  podPaymentMethod?: "cash" | "mobile_money";
  amount?: string;
}): string {
  const deliveryMethodText =
    params.deliveryMethod === "pickup" ? "picked up" : "delivered";

  const processingMessage = PAYMENT_CONSTANTS.MESSAGES.PROCESSING_TIME;

  if (params.isPaymentOnDelivery && params.amount && params.podPaymentMethod) {
    const paymentMethodText =
      params.podPaymentMethod === "mobile_money" ? "mobile money" : "cash";
    const paymentMessage = `You'll pay ${params.amount} via ${paymentMethodText} when your order is ${deliveryMethodText}.`;
    return `Your order has been placed successfully! ${processingMessage} ${paymentMessage}`;
  }

  if (params.deliveryMethod === "pickup") {
    return PAYMENT_CONSTANTS.MESSAGES.PICKUP_PROCESSING;
  }

  return PAYMENT_CONSTANTS.MESSAGES.DELIVERY_PROCESSING;
}

/**
 * Build pickup details string based on delivery method
 */
export function buildPickupDetails(params: {
  deliveryMethod: string;
  deliveryDetails: any;
  storeLocation?: string;
}): string {
  if (params.deliveryMethod === "pickup") {
    return params.storeLocation || "Store location";
  }

  if (params.deliveryDetails) {
    return getAddressString(params.deliveryDetails as Address);
  }

  return "Details not available";
}

/**
 * Send order confirmation and admin notification emails for POD orders
 */
export async function sendPODOrderEmails(params: {
  order: OrderDetails;
  store: StoreDetails | null;
  amount: number;
  podPaymentMethod?: "cash" | "mobile_money";
}): Promise<{
  confirmationSent: boolean;
  adminNotificationSent: boolean;
}> {
  const formatter = currencyFormatter(params.store?.currency || "GHS");

  const orderStatusMessaging = buildOrderStatusMessage({
    deliveryMethod: params.order.deliveryMethod,
    isPaymentOnDelivery: true,
    podPaymentMethod: params.podPaymentMethod,
    amount: formatter.format(params.amount / 100),
  });

  const deliveryAddress = buildPickupDetails({
    deliveryMethod: params.order.deliveryMethod,
    deliveryDetails: params.order.deliveryDetails,
    storeLocation: params.store?.config?.contactInfo?.location,
  });

  const items = formatOrderItems(
    params.order.items || [],
    params.store?.currency || "GHS",
    params.order.discount
  );

  const discountValue = getDiscountValue(
    params.order.items || [],
    params.order.discount
  );

  let confirmationSent = false;
  let adminNotificationSent = false;

  // Send customer confirmation email
  try {
    const emailResponse = await sendOrderEmail({
      type: "confirmation",
      customerEmail: params.order.customerDetails.email,
      delivery_fee: params.order.deliveryFee
        ? formatter.format(params.order.deliveryFee)
        : undefined,
      discount: params.order.discount
        ? formatter.format(discountValue / 100)
        : undefined,
      store_name: PAYMENT_CONSTANTS.STORE_NAME,
      order_number: params.order.orderNumber,
      order_date: formatDate(params.order._creationTime),
      order_status_messaging: orderStatusMessaging,
      total: formatter.format(params.amount / 100),
      subtotal: formatter.format(params.amount / 100),
      items,
      pickup_type: params.order.deliveryMethod,
      pickup_details: deliveryAddress,
      customer_name: params.order.customerDetails.firstName,
    });

    if (emailResponse.ok) {
      confirmationSent = true;
    }
  } catch (error) {
    // handled
  }

  // Send admin notification if not a test account
  if (shouldSendToAdmins(params.order.customerDetails.email)) {
    try {
      const paymentMethodDisplay =
        params.podPaymentMethod === "mobile_money" ? "Mobile Money" : "Cash";
      const adminEmailResponse = await sendNewOrderEmail({
        store_name: PAYMENT_CONSTANTS.STORE_NAME,
        order_amount: formatter.format(params.amount / 100),
        order_status: `Payment on Delivery (${paymentMethodDisplay})`,
        order_date: formatDate(params.order._creationTime),
        customer_name: `${params.order.customerDetails.firstName} ${params.order.customerDetails.lastName}`,
        order_id: params.order._id,
      });

      if (adminEmailResponse.ok) {
        adminNotificationSent = true;
      }
    } catch (error) {
      // handled
    }
  }

  return { confirmationSent, adminNotificationSent };
}

/**
 * Send order confirmation and admin notification emails for paid orders
 */
export async function sendPaymentVerificationEmails(params: {
  order: OrderDetails;
  store: StoreDetails | null;
  orderAmount: number;
  discountValue: number;
  didSendNewOrderEmail: boolean;
  didSendConfirmationEmail: boolean;
}): Promise<{
  confirmationSent: boolean;
  adminNotificationSent: boolean;
}> {
  const formatter = currencyFormatter(params.store?.currency || "GHS");
  let confirmationSent = false;
  let adminNotificationSent = false;

  // Send admin notification if not sent and not a test account
  if (
    !params.didSendNewOrderEmail &&
    shouldSendToAdmins(params.order.customerDetails.email)
  ) {
    try {
      const emailResponse = await sendNewOrderEmail({
        store_name: PAYMENT_CONSTANTS.STORE_NAME,
        order_amount: formatter.format(params.orderAmount / 100),
        order_status: "Paid",
        order_date: formatDate(params.order._creationTime),
        customer_name: `${params.order.customerDetails.firstName} ${params.order.customerDetails.lastName}`,
        order_id: params.order._id,
      });

      if (emailResponse.ok) {
        adminNotificationSent = true;
      }
    } catch (error) {
      // handled
    }
  }

  // Send customer confirmation email
  if (!params.didSendConfirmationEmail) {
    try {
      const orderStatusMessaging = buildOrderStatusMessage({
        deliveryMethod: params.order.deliveryMethod,
      });

      const pickupDetails = buildPickupDetails({
        deliveryMethod: params.order.deliveryMethod,
        deliveryDetails: params.order.deliveryDetails,
        storeLocation: params.store?.config?.contactInfo?.location,
      });

      const items = formatOrderItems(
        params.order.items || [],
        params.store?.currency || "GHS",
        params.order.discount
      );

      const discountValue = getDiscountValue(
        params.order.items || [],
        params.order.discount
      );

      const amountMinusDeliveryFee =
        params.orderAmount - (params.order.deliveryFee || 0) * 100;

      const amountWithDiscount = amountMinusDeliveryFee + discountValue;

      const emailResponse = await sendOrderEmail({
        type: "confirmation",
        customerEmail: params.order.customerDetails.email,
        delivery_fee: params.order.deliveryFee
          ? formatter.format(params.order.deliveryFee)
          : undefined,
        discount: discountValue
          ? formatter.format(discountValue / 100)
          : undefined,
        store_name: PAYMENT_CONSTANTS.STORE_NAME,
        order_number: params.order.orderNumber,
        order_date: formatDate(params.order._creationTime),
        order_status_messaging: orderStatusMessaging,
        total: formatter.format(params.orderAmount / 100),
        subtotal: formatter.format(amountWithDiscount / 100),
        items,
        pickup_type: params.order.deliveryMethod,
        pickup_details: pickupDetails,
        customer_name: params.order.customerDetails.firstName,
      });

      if (emailResponse.ok) {
        confirmationSent = true;
      }
    } catch (error) {
      // handled
    }
  }

  return { confirmationSent, adminNotificationSent };
}
