/**
 * Payment-related constants
 */

export const PAYMENT_CONSTANTS = {
  STORE_NAME: "Wigclub",
  STORE_ADDRESS: "2 Jungle Avenue, East Legon\nAccra, Ghana",

  // Paystack API endpoints
  PAYSTACK_API: {
    INITIALIZE: "https://api.paystack.co/transaction/initialize",
    VERIFY: "https://api.paystack.co/transaction/verify",
    REFUND: "https://api.paystack.co/refund",
  },

  // Order processing messages
  MESSAGES: {
    PROCESSING_TIME:
      "We're currently processing your order and will notify you when it's ready. Please note that processing typically takes 24-48 hours.",
    PICKUP_PROCESSING:
      "We're processing your order and will notify you once it's ready for pickup. Processing takes 24-48 hours.",
    DELIVERY_PROCESSING:
      "We're processing your order and will notify you once it's on the way. Processing takes 24-48 hours.",
  },

  // Rewards calculation
  POINTS_PER_DOLLAR: 10,
  POINTS_DIVISOR: 1000, // Amount is in cents, so divide by 1000 to get dollars then multiply by 10
} as const;

export const TEST_ACCOUNTS = ["kwamina.0x00@gmail.com", "kwami.nuh@gmail.com"];
