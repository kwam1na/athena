import { Hono } from "hono";

import {
  DEFAULT_INGRESS_MAX_BODY_BYTES,
  readBoundedRequestBody,
  requestWithBody,
} from "../../../../operationAdmission/ingressBody";
import { HonoWithConvex } from "convex-helpers/server/hono";

import { internal } from "../../../../_generated/api";
import { ActionCtx } from "../../../../_generated/server";
import { verifyMetaWebhookSignature } from "../../../../customerMessaging/webhookSecurity";
import {
  getWhatsAppWebhookAppSecret,
  getWhatsAppWebhookVerifyToken,
} from "../../../../customerMessaging/whatsappConfig";
import { whatsappWebhookRouteOperationDefinition } from "../../../../operationAdmission/domains/httpCore_definitions";
import { whatsappWebhookVerificationRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";

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

/**
 * Signature verification stays in front of the rail on the delivery callback.
 *
 * The same HMAC is declared on the definition as an ingress verifier, so the
 * boundary lives where the operation is declared; this middleware is what keeps
 * Meta's status contract exact — 401 for a bad or missing signature, 503 when
 * the app secret is not configured — and it runs before the admission mutation,
 * so a rejected callback leaves no admission row behind.
 *
 * The middleware MUST hand the rail a fresh Request. A Fetch body stream is
 * readable exactly once, and the rail reads `c.req.raw.body` directly rather
 * than through Hono's `HonoRequest#bodyCache` — so consuming the body here and
 * calling `next()` would leave the rail reading an empty body, failing its own
 * declared signature verifier and denying every genuine callback. Reconstruct
 * the request from the bytes we read, exactly as `boundRequestBody` does.
 */
whatsappMessagingRoutes.use("*", async (c, next) => {
  if (c.req.method !== "POST") return next();

  let appSecret;
  try {
    appSecret = getWhatsAppWebhookAppSecret();
  } catch {
    return c.json({ error: "Webhook verification is not configured" }, 503);
  }

  // Bounded HERE, not just in the rail. These are unauthenticated endpoints:
  // reading the body with `c.req.text()` before any credential is checked lets
  // an anonymous caller make the isolate buffer (and HMAC) an unbounded body,
  // and the rail's 413 would only fire after the whole thing had been read.
  const bounded = await readBoundedRequestBody(
    c.req.raw,
    DEFAULT_INGRESS_MAX_BODY_BYTES,
  );
  if (bounded.kind === "too_large") {
    return c.json({ error: "Request body too large." }, 413);
  }
  const rawBody = new TextDecoder().decode(bounded.bytes);
  const verified = await verifyMetaWebhookSignature({
    appSecret,
    rawBody,
    signatureHeader: c.req.header("x-hub-signature-256"),
  });

  if (!verified) {
    return c.json({ error: "Webhook verification failed" }, 401);
  }

  // The original stream is spent; give the rail the same bytes to re-verify
  // and to hand the handler.
  c.req.raw = requestWithBody(c.req.raw, bounded.bytes);

  await next();
});

whatsappMessagingRoutes.get(
  "/",
  admitHttpRead(whatsappWebhookVerificationRouteReadDefinition, (c) => {
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
  }),
);

whatsappMessagingRoutes.post(
  "/",
  admitHttpRoute(
    whatsappWebhookRouteOperationDefinition,
    async (c, { ingress }) => {
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
        // The signed bytes and the parsed bytes are the same string.
        payload = JSON.parse(ingress.rawBody) as typeof payload;
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
    },
  ),
);

export { whatsappMessagingRoutes };
