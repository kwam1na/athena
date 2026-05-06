const SIGNATURE_PREFIX = "sha256=";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
}

export async function verifyMetaWebhookSignature(args: {
  appSecret: string;
  rawBody: string;
  signatureHeader?: string;
}) {
  if (!args.signatureHeader?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(args.appSecret),
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
    new TextEncoder().encode(args.rawBody),
  );

  return timingSafeEqual(
    toHex(signature),
    args.signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase(),
  );
}
