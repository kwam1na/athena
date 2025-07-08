export interface WelcomeBackModalConfig {
  title: string;
  subtitle?: string;
  body: string;
  backgroundImageUrl: string;
  ctaText: string;
}

// Default background image URL
export const defaultBackgroundImageUrl =
  "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/products/n5790y3zfjn41k43ghjtqhjbxh7c5n5j/66093c1a-01c0-4f90-5e91-4f91231e906a.webp";

// Modal configurations
export const welcomeBackConfigs: WelcomeBackModalConfig[] = [
  {
    title: "Get 25% off your first order",
    body: "Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Send My Code",
  },
  {
    title: "Get 25% off your first order",
    body: "Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Claim my discount",
  },
];

export const nextOrderConfigs: WelcomeBackModalConfig[] = [
  {
    title: "Get 25% off your next order",
    body: "Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Send My Code",
  },
  {
    title: "Get 25% off your next order",
    body: "Enter your email and we'll send you a discount code to use at checkout.",
    backgroundImageUrl: defaultBackgroundImageUrl,
    ctaText: "Claim my discount",
  },
];
