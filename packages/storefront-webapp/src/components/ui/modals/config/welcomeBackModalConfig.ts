export interface WelcomeBackModalConfig {
  title: string;
  subtitle?: string;
  body: string;
  backgroundImageUrl: string;
  ctaText: string;
}

// Default background image URL
export const defaultBackgroundImageUrl =
  "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/products/n577j9mfqfyfpfzfq9qsvjapyn7bxtx6/3e554876-12ef-49c7-2e79-d603cdff1152.webp";

// Modal configurations
export const welcomeBackConfigs: WelcomeBackModalConfig[] = [
  {
    title: "Get 25% off your first order",
    body: "Enjoy 25% off your first order. Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Send My Code",
  },
  {
    title: "Get 25% off your first order",
    body: "Enjoy 25% off your first order. Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Claim my discount",
  },
];

export const nextOrderConfigs: WelcomeBackModalConfig[] = [
  {
    title: "Get 25% off your next order",
    body: "Enjoy 25% off your next order. Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Send My Code",
  },
  {
    title: "Get 25% off your next order",
    body: "Enjoy 25% off your next order. Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Claim my discount",
  },
];
