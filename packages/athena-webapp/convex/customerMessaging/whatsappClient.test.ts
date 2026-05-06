import { describe, expect, it, vi } from "vitest";

import { sendWhatsAppReceiptTemplate } from "./whatsappClient";
import type { WhatsAppReceiptConfig } from "./whatsappConfig";

const config: WhatsAppReceiptConfig = {
  accessToken: "token",
  phoneNumberId: "phone-number-id",
  receiptTemplateName: "pos_receipt",
  templateLanguage: "en_US",
  graphApiVersion: "v24.0",
  storefrontReceiptBaseUrl: "https://wigclub.store",
};

describe("sendWhatsAppReceiptTemplate", () => {
  it("sends a receipt utility template with transaction variables", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ id: "wamid.receipt-1" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await sendWhatsAppReceiptTemplate(
      config,
      {
        to: "233550000000",
        storeName: "Wig Club",
        transactionNumber: "POS-123456",
        receiptUrl: "https://wigclub.store/shop/receipt/s/token",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      providerMessageId: "wamid.receipt-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v24.0/phone-number-id/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: "233550000000",
          type: "template",
          template: {
            name: "pos_receipt",
            language: { code: "en_US" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: "Wig Club" },
                  { type: "text", text: "POS-123456" },
                  {
                    type: "text",
                    text: "https://wigclub.store/shop/receipt/s/token",
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
  });

  it("maps provider failures to safe application errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "raw provider text" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      sendWhatsAppReceiptTemplate(
        config,
        {
          to: "233550000000",
          storeName: "Wig Club",
          transactionNumber: "POS-123456",
          receiptUrl: "https://wigclub.store/shop/receipt/s/token",
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      ok: false,
      category: "authentication",
      message: "WhatsApp could not accept the receipt message.",
    });
  });
});
