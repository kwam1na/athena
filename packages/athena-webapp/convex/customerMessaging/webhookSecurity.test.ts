import { describe, expect, it } from "vitest";

import { verifyMetaWebhookSignature } from "./webhookSecurity";

async function sign(rawBody: string, appSecret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );

  return `sha256=${Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("webhook security", () => {
  it("accepts Meta signatures computed from the raw body", async () => {
    const rawBody = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1" }] } }] }],
    });
    const signatureHeader = await sign(rawBody, "app-secret");

    await expect(
      verifyMetaWebhookSignature({
        appSecret: "app-secret",
        rawBody,
        signatureHeader,
      }),
    ).resolves.toBe(true);
  });

  it("rejects missing or mismatched Meta signatures", async () => {
    const rawBody = JSON.stringify({ entry: [] });

    await expect(
      verifyMetaWebhookSignature({
        appSecret: "app-secret",
        rawBody,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyMetaWebhookSignature({
        appSecret: "app-secret",
        rawBody,
        signatureHeader: await sign(`${rawBody}changed`, "app-secret"),
      }),
    ).resolves.toBe(false);
  });
});
