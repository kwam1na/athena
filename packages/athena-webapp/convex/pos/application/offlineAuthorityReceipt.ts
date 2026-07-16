import { env } from "../../_generated/server";

export const POS_OFFLINE_AUTHORITY_RECEIPT_VERSION = 1;
export const POS_OFFLINE_AUTHORITY_AUDIENCE = "athena.pos.offline";
export const POS_OFFLINE_AUTHORITY_MAX_LEASE_MS = 24 * 60 * 60 * 1000;

export type PosOfflineAuthorityReceiptPayload = {
  audience: typeof POS_OFFLINE_AUTHORITY_AUDIENCE;
  capabilityId: "pos.application";
  capabilityRevision: number;
  credentialRevision: number;
  expiresAt: number;
  issuedAt: number;
  issuer: string;
  keyVersion: number;
  nonce: string;
  posApplicationSessionBindingId: string;
  principalLifecycleRevision: number;
  servicePrincipalId: string;
  servicePrincipalSessionId: string;
  storeId: string;
  terminalId: string;
  terminalLifecycleRevision: number;
  terminalProofRevision: number;
  version: typeof POS_OFFLINE_AUTHORITY_RECEIPT_VERSION;
};

type SigningKeyState = "current" | "retiring" | "revoked";

type SigningKeyConfig = {
  privateKeyJwk?: JsonWebKey;
  privateKeyPkcs8Base64Url?: string;
  publicKeyJwk: JsonWebKey;
  state: SigningKeyState;
  version: number;
};

type OfflineAuthorityConfig = {
  issuer: string;
  leaseMs: number;
  keys: SigningKeyConfig[];
};

export type OfflineAuthorityReceiptVerification =
  | { disposition: "valid"; payload: PosOfflineAuthorityReceiptPayload }
  | {
      disposition: "needs_review";
      reason: "missing_receipt" | "outside_lease" | "ambiguous_time";
      payload?: PosOfflineAuthorityReceiptPayload;
    }
  | {
      disposition: "rejected";
      reason:
        | "forged_or_malformed"
        | "scope_mismatch"
        | "revoked_key"
        | "replayed_scope";
    }
  | { disposition: "infrastructure_failure" };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalJsonV1(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function copyToArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function isJsonWebKey(value: unknown): value is JsonWebKey {
  return Boolean(value && typeof value === "object");
}

function readConfig(): OfflineAuthorityConfig {
  let value: unknown;
  try {
    value = JSON.parse(env.POS_OFFLINE_AUTHORITY_KEYS_JSON ?? "");
  } catch {
    throw new Error("POS offline authority signing is not configured.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("POS offline authority signing is not configured.");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.issuer !== "string" ||
    !raw.issuer.trim() ||
    !Number.isSafeInteger(raw.leaseMs) ||
    (raw.leaseMs as number) <= 0 ||
    (raw.leaseMs as number) > POS_OFFLINE_AUTHORITY_MAX_LEASE_MS ||
    !Array.isArray(raw.keys)
  ) {
    throw new Error("POS offline authority signing is not configured.");
  }
  const keys = raw.keys.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("POS offline authority signing is not configured.");
    }
    const key = candidate as Record<string, unknown>;
    if (
      !Number.isSafeInteger(key.version) ||
      (key.version as number) < 1 ||
      !["current", "retiring", "revoked"].includes(String(key.state)) ||
      !isJsonWebKey(key.publicKeyJwk) ||
      (key.privateKeyJwk !== undefined && !isJsonWebKey(key.privateKeyJwk)) ||
      (key.privateKeyPkcs8Base64Url !== undefined &&
        typeof key.privateKeyPkcs8Base64Url !== "string")
    ) {
      throw new Error("POS offline authority signing is not configured.");
    }
    return {
      version: key.version as number,
      state: key.state as SigningKeyState,
      publicKeyJwk: key.publicKeyJwk,
      ...(key.privateKeyJwk === undefined
        ? {}
        : { privateKeyJwk: key.privateKeyJwk }),
      ...(key.privateKeyPkcs8Base64Url === undefined
        ? {}
        : {
            privateKeyPkcs8Base64Url:
              key.privateKeyPkcs8Base64Url as string,
          }),
    };
  });
  if (
    new Set(keys.map(({ version }) => version)).size !== keys.length ||
    keys.filter(({ state }) => state === "current").length !== 1
  ) {
    throw new Error("POS offline authority signing is not configured.");
  }
  return { issuer: raw.issuer, leaseMs: raw.leaseMs as number, keys };
}

async function importPrivateKey(key: SigningKeyConfig) {
  if (key.privateKeyJwk) {
    return crypto.subtle.importKey(
      "jwk",
      key.privateKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  }
  if (key.privateKeyPkcs8Base64Url) {
    return crypto.subtle.importKey(
      "pkcs8",
      decodeBase64Url(key.privateKeyPkcs8Base64Url),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  }
  throw new Error("POS offline authority signing is not configured.");
}

async function importPublicKey(key: SigningKeyConfig) {
  return crypto.subtle.importKey(
    "jwk",
    key.publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function issuePosOfflineAuthorityReceipt(input: {
  authorityExpiresAt: number;
  capabilityRevision: number;
  credentialRevision: number;
  issuedAt: number;
  posApplicationSessionBindingId: string;
  principalLifecycleRevision: number;
  servicePrincipalId: string;
  servicePrincipalSessionId: string;
  storeId: string;
  terminalId: string;
  terminalLifecycleRevision: number;
  terminalProofRevision: number;
}) {
  const config = readConfig();
  const key = config.keys.find(({ state }) => state === "current");
  if (!key) throw new Error("POS offline authority signing is not configured.");
  const payload: PosOfflineAuthorityReceiptPayload = {
    audience: POS_OFFLINE_AUTHORITY_AUDIENCE,
    capabilityId: "pos.application",
    capabilityRevision: input.capabilityRevision,
    credentialRevision: input.credentialRevision,
    expiresAt: Math.min(
      input.issuedAt + config.leaseMs,
      input.authorityExpiresAt,
    ),
    issuedAt: input.issuedAt,
    issuer: config.issuer,
    keyVersion: key.version,
    nonce: randomNonce(),
    posApplicationSessionBindingId: input.posApplicationSessionBindingId,
    principalLifecycleRevision: input.principalLifecycleRevision,
    servicePrincipalId: input.servicePrincipalId,
    servicePrincipalSessionId: input.servicePrincipalSessionId,
    storeId: input.storeId,
    terminalId: input.terminalId,
    terminalLifecycleRevision: input.terminalLifecycleRevision,
    terminalProofRevision: input.terminalProofRevision,
    version: POS_OFFLINE_AUTHORITY_RECEIPT_VERSION,
  };
  if (payload.expiresAt <= payload.issuedAt) {
    throw new Error("POS offline authority signing is not configured.");
  }
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(canonicalJsonV1(payload)),
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importPrivateKey(key),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function isReceiptPayload(value: unknown): value is PosOfflineAuthorityReceiptPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === POS_OFFLINE_AUTHORITY_RECEIPT_VERSION &&
    payload.audience === POS_OFFLINE_AUTHORITY_AUDIENCE &&
    payload.capabilityId === "pos.application" &&
    typeof payload.issuer === "string" &&
    typeof payload.storeId === "string" &&
    typeof payload.terminalId === "string" &&
    typeof payload.servicePrincipalId === "string" &&
    typeof payload.servicePrincipalSessionId === "string" &&
    typeof payload.posApplicationSessionBindingId === "string" &&
    typeof payload.nonce === "string" &&
    Number.isSafeInteger(payload.keyVersion) &&
    Number.isSafeInteger(payload.issuedAt) &&
    Number.isSafeInteger(payload.expiresAt) &&
    Number.isSafeInteger(payload.principalLifecycleRevision) &&
    Number.isSafeInteger(payload.capabilityRevision) &&
    Number.isSafeInteger(payload.credentialRevision) &&
    Number.isSafeInteger(payload.terminalLifecycleRevision) &&
    Number.isSafeInteger(payload.terminalProofRevision)
  );
}

export async function verifyPosOfflineAuthorityReceiptForEvent(input: {
  eventOccurredAt: number;
  receipt?: string;
  storeId: string;
  terminalId: string;
}): Promise<OfflineAuthorityReceiptVerification> {
  if (!input.receipt) {
    return { disposition: "needs_review", reason: "missing_receipt" };
  }
  let encodedPayload: string;
  let signature: Uint8Array;
  let payload: PosOfflineAuthorityReceiptPayload;
  try {
    const segments = input.receipt.split(".");
    if (segments.length !== 2) throw new Error("malformed");
    [encodedPayload] = segments;
    signature = decodeBase64Url(segments[1]);
    if (
      signature.length !== 64 ||
      encodeBase64Url(signature) !== segments[1]
    ) {
      throw new Error("noncanonical signature");
    }
    payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as PosOfflineAuthorityReceiptPayload;
    if (!isReceiptPayload(payload)) throw new Error("malformed");
    const canonicalEncoded = encodeBase64Url(
      new TextEncoder().encode(canonicalJsonV1(payload)),
    );
    if (canonicalEncoded !== encodedPayload) throw new Error("noncanonical");
  } catch {
    return { disposition: "rejected", reason: "forged_or_malformed" };
  }

  let config: OfflineAuthorityConfig;
  try {
    config = readConfig();
  } catch {
    return { disposition: "infrastructure_failure" };
  }
  const key = config.keys.find(({ version }) => version === payload.keyVersion);
  if (!key) return { disposition: "infrastructure_failure" };
  if (key.state === "revoked") {
    return { disposition: "rejected", reason: "revoked_key" };
  }
  if (payload.issuer !== config.issuer) {
    return { disposition: "rejected", reason: "replayed_scope" };
  }
  let verified: boolean;
  try {
    verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await importPublicKey(key),
      copyToArrayBufferView(signature),
      new TextEncoder().encode(encodedPayload),
    );
  } catch {
    return { disposition: "infrastructure_failure" };
  }
  if (!verified) {
    return { disposition: "rejected", reason: "forged_or_malformed" };
  }
  if (payload.storeId !== input.storeId || payload.terminalId !== input.terminalId) {
    return { disposition: "rejected", reason: "scope_mismatch" };
  }
  if (
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > POS_OFFLINE_AUTHORITY_MAX_LEASE_MS ||
    !Number.isFinite(input.eventOccurredAt)
  ) {
    return { disposition: "needs_review", reason: "ambiguous_time", payload };
  }
  if (
    input.eventOccurredAt < payload.issuedAt ||
    input.eventOccurredAt > payload.expiresAt
  ) {
    return { disposition: "needs_review", reason: "outside_lease", payload };
  }
  return { disposition: "valid", payload };
}
