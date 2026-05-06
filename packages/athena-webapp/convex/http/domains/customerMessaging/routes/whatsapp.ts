import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import { ActionCtx } from "../../../../_generated/server";
import { verifyMetaWebhookSignature } from "../../../../customerMessaging/webhookSecurity";
import {
  getWhatsAppWebhookAppSecret,
  getWhatsAppWebhookVerifyToken,
} from "../../../../customerMessaging/whatsappConfig";

const whatsappMessagingRoutes: HonoWithConvex<ActionCtx> = new Hono();
const customerMessagingInternal = (internal as any).customerMessaging.internal;

function mapWebhookStatus(status: string) {
  if (status === "sent" || status === "delivered" || status === "read") {
    return status;
  }
  if (status === "failed") {
    return "failed";
  }
  return "unknown";
}

whatsappMessagingRoutes.get("/", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const verifyToken = getWhatsAppWebhookVerifyToken();

  if (
    mode === "subscribe" &&
    token &&
    challenge &&
    token === verifyToken
  ) {
    return c.text(challenge);
  }

  return c.json({ error: "Webhook verification failed" }, 403);
});

whatsappMessagingRoutes.post("/", async (c) => {
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header("x-hub-signature-256");
  let appSecret;

  try {
    appSecret = getWhatsAppWebhookAppSecret();
  } catch {
    return c.json({ error: "Webhook verification is not configured" }, 503);
  }

  const verified = await verifyMetaWebhookSignature({
    appSecret,
    rawBody,
    signatureHeader,
  });

  if (!verified) {
    return c.json({ error: "Webhook verification failed" }, 401);
  }

  let payload: {
    entry?: Array<{
      changes?: Array<{
        value?: {
          statuses?: Array<{
            id?: string;
            status?: string;
          }>;
        };
      }>;
    }>;
  };

  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return c.json({ error: "Invalid webhook payload" }, 400);
  }

  const statuses =
    payload.entry?.flatMap((entry) =>
      entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? [],
    ) ?? [];

  await Promise.all(
    statuses.flatMap((status) => {
      if (!status.id || !status.status) {
        return [];
      }

      return c.env.runMutation(
        customerMessagingInternal.updateWebhookStatus,
        {
          providerMessageId: status.id,
          status: mapWebhookStatus(status.status),
          providerStatus: status.status,
        },
      );
    }),
  );

  return c.json({ message: "OK" });
});

export { whatsappMessagingRoutes };
