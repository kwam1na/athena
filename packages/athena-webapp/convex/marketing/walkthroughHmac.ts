import { env } from "../_generated/server";

type HmacKey = {
  secret: string;
  version: string;
};

function priorKeyring(): Record<string, string> {
  const encoded = env.WALKTHROUGH_HMAC_PRIOR_KEYRING;
  if (!encoded) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid key ring shape");
    }

    const entries = Object.entries(parsed);
    if (
      entries.some(
        ([version, secret]) =>
          version.length === 0 ||
          typeof secret !== "string" ||
          secret.length < 32,
      )
    ) {
      throw new Error("invalid key ring entry");
    }
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    throw new Error("Walkthrough prior HMAC key ring is invalid");
  }
}

export function getActiveWalkthroughHmacKey(): HmacKey {
  const version = env.WALKTHROUGH_HMAC_ACTIVE_VERSION;
  const secret = env.WALKTHROUGH_HMAC_ACTIVE_SECRET;
  if (!version || !secret || secret.length < 32) {
    throw new Error("Walkthrough HMAC configuration missing");
  }
  return { secret, version };
}

export function getWalkthroughHmacVerificationKeys(): HmacKey[] {
  const active = getActiveWalkthroughHmacKey();
  const prior = priorKeyring();
  if (Object.hasOwn(prior, active.version)) {
    throw new Error("Active walkthrough HMAC version is duplicated in the prior key ring");
  }
  return [
    active,
    ...Object.entries(prior).map(([version, secret]) => ({ version, secret })),
  ];
}

export function getWalkthroughHmacSecret(version: string): string {
  const active = getActiveWalkthroughHmacKey();
  if (version === active.version) {
    return active.secret;
  }

  const secret = priorKeyring()[version];
  if (!secret) {
    throw new Error("Walkthrough HMAC verification key missing");
  }
  return secret;
}

export async function createWalkthroughDedupeHmac(
  normalizedEmail: string,
  payloadDigest: string,
  secret: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = `${normalizedEmail}\n${payloadDigest}`;
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function matchesWalkthroughTombstone(
  tombstone: { dedupeHmac: string; keyVersion: string },
  normalizedEmail: string,
  payloadDigest: string,
) {
  const secret = getWalkthroughHmacSecret(tombstone.keyVersion);
  const candidate = await createWalkthroughDedupeHmac(
    normalizedEmail,
    payloadDigest,
    secret,
  );
  return candidate === tombstone.dedupeHmac;
}
