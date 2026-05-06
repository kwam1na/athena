import { describe, expect, it, vi } from "vitest";

describe("WhatsApp receipt config", () => {
  it("requires provider credentials and receipt base URL from env", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "access-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-number-id");
    vi.stubEnv("WHATSAPP_RECEIPT_TEMPLATE_NAME", "pos_receipt_link");
    vi.stubEnv("WHATSAPP_TEMPLATE_LANGUAGE", "en_US");
    vi.stubEnv("WHATSAPP_GRAPH_API_VERSION", "v24.0");
    vi.stubEnv("STOREFRONT_RECEIPT_BASE_URL", "https://shop.example.com/");
    vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "verify-token");
    vi.stubEnv("WHATSAPP_WEBHOOK_APP_SECRET", "app-secret");

    const {
      buildReceiptShareUrl,
      getWhatsAppReceiptConfig,
      getWhatsAppWebhookAppSecret,
    } = await import("./whatsappConfig");
    const config = getWhatsAppReceiptConfig();

    expect(config).toEqual({
      accessToken: "access-token",
      phoneNumberId: "phone-number-id",
      receiptTemplateName: "pos_receipt_link",
      templateLanguage: "en_US",
      graphApiVersion: "v24.0",
      storefrontReceiptBaseUrl: "https://shop.example.com/",
      webhookVerifyToken: "verify-token",
    });
    expect(buildReceiptShareUrl(config, "token")).toBe(
      "https://shop.example.com/shop/receipt/s/token",
    );
    expect(getWhatsAppWebhookAppSecret()).toBe("app-secret");

    vi.unstubAllEnvs();
  });
});
