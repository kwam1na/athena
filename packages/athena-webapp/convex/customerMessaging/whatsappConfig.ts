export type WhatsAppReceiptConfig = {
  accessToken: string;
  phoneNumberId: string;
  receiptTemplateName: string;
  templateLanguage: string;
  graphApiVersion: string;
  storefrontReceiptBaseUrl: string;
  webhookVerifyToken?: string;
};

function optionalEnv(name: string) {
  return process.env[name]?.trim();
}

function requiredEnv(name: string) {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

export function getWhatsAppReceiptConfig(): WhatsAppReceiptConfig {
  return {
    accessToken: requiredEnv("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requiredEnv("WHATSAPP_PHONE_NUMBER_ID"),
    receiptTemplateName: requiredEnv("WHATSAPP_RECEIPT_TEMPLATE_NAME"),
    templateLanguage: optionalEnv("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en_US",
    graphApiVersion: optionalEnv("WHATSAPP_GRAPH_API_VERSION") ?? "v24.0",
    storefrontReceiptBaseUrl: requiredEnv("STOREFRONT_RECEIPT_BASE_URL"),
    webhookVerifyToken: optionalEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
  };
}

export function getWhatsAppWebhookVerifyToken() {
  return requiredEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
}

export function getWhatsAppWebhookAppSecret() {
  return requiredEnv("WHATSAPP_WEBHOOK_APP_SECRET");
}

export function buildReceiptShareUrl(config: WhatsAppReceiptConfig, token: string) {
  return `${config.storefrontReceiptBaseUrl.replace(/\/+$/, "")}/shop/receipt/s/${token}`;
}
