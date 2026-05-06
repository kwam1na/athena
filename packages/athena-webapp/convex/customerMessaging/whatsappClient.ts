import type { WhatsAppReceiptConfig } from "./whatsappConfig";

type FetchLike = typeof fetch;

export type SendWhatsAppReceiptInput = {
  to: string;
  storeName: string;
  transactionNumber: string;
  receiptUrl: string;
};

export type WhatsAppSendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      category: "configuration" | "validation" | "authentication" | "rate_limited" | "provider";
      message: string;
    };

function providerErrorCategory(status: number): Exclude<WhatsAppSendResult, { ok: true }>["category"] {
  if (status === 400) return "validation";
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limited";
  return "provider";
}

export async function sendWhatsAppReceiptTemplate(
  config: WhatsAppReceiptConfig,
  input: SendWhatsAppReceiptInput,
  fetchImpl: FetchLike = fetch,
): Promise<WhatsAppSendResult> {
  const response = await fetchImpl(
    `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: config.receiptTemplateName,
          language: {
            code: config.templateLanguage,
          },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: input.storeName },
                { type: "text", text: input.transactionNumber },
                { type: "text", text: input.receiptUrl },
              ],
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    return {
      ok: false,
      category: providerErrorCategory(response.status),
      message: "WhatsApp could not accept the receipt message.",
    };
  }

  const payload = (await response.json()) as {
    messages?: Array<{ id?: string }>;
  };
  const providerMessageId = payload.messages?.[0]?.id;

  if (!providerMessageId) {
    return {
      ok: false,
      category: "provider",
      message: "WhatsApp accepted the request without a message id.",
    };
  }

  return { ok: true, providerMessageId };
}
