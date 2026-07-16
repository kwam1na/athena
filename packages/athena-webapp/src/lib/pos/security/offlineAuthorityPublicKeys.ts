export const POS_OFFLINE_AUTHORITY_RECEIPT_VERSION = 1 as const;
export const POS_OFFLINE_AUTHORITY_AUDIENCE = "athena.pos.offline" as const;
export const POS_OFFLINE_AUTHORITY_MAX_LEASE_MS = 24 * 60 * 60 * 1_000;

export type PosOfflineAuthorityPublicKeyState =
  | "current"
  | "retiring"
  | "revoked";

export type PosOfflineAuthorityPublicKey = Readonly<{
  issuer: string;
  keyVersion: number;
  publicKeyJwk: JsonWebKey;
  state: PosOfflineAuthorityPublicKeyState;
}>;

/**
 * Reviewed browser trust anchors only. A release must add public JWKs here
 * before its receipts can authorize local continuation. Private key material
 * and runtime server configuration must never be imported into this module.
 */
const DEV_POS_OFFLINE_AUTHORITY_PUBLIC_KEYS: readonly PosOfflineAuthorityPublicKey[] =
  Object.freeze([
    {
      issuer: "athena-dev-pos-authority",
      keyVersion: 1,
      publicKeyJwk: {
        crv: "P-256",
        ext: true,
        key_ops: ["verify"],
        kty: "EC",
        x: "HHW7ebnK8s-ZSUiwc9U8AVXCO8gXO9R6TWbxdUX9K-A",
        y: "oMEdJIVKn7O2Ebi3S1fvdbDrZX9uhNYyfzlMnC24wNI",
      },
      state: "current",
    },
  ]);

export const POS_OFFLINE_AUTHORITY_PUBLIC_KEYS: readonly PosOfflineAuthorityPublicKey[] =
  import.meta.env.DEV ? DEV_POS_OFFLINE_AUTHORITY_PUBLIC_KEYS : Object.freeze([]);

export type PosOfflineAuthorityReceiptPayloadV1 = {
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

export type VerifiedPosOfflineAuthorityReceipt = {
  envelope: string;
  payload: PosOfflineAuthorityReceiptPayloadV1;
  verifiedAt: number;
};

export type PosOfflineAuthorityReceiptVerification =
  | { status: "valid"; receipt: VerifiedPosOfflineAuthorityReceipt }
  | {
      status: "rejected";
      reason:
        | "invalid_signature"
        | "malformed"
        | "outside_lease"
        | "revoked_key"
        | "scope_mismatch"
        | "unknown_key";
    };

const PAYLOAD_KEYS = [
  "audience",
  "capabilityId",
  "capabilityRevision",
  "credentialRevision",
  "expiresAt",
  "issuedAt",
  "issuer",
  "keyVersion",
  "nonce",
  "posApplicationSessionBindingId",
  "principalLifecycleRevision",
  "servicePrincipalId",
  "servicePrincipalSessionId",
  "storeId",
  "terminalId",
  "terminalLifecycleRevision",
  "terminalProofRevision",
  "version",
] as const;

export async function verifyPosOfflineAuthorityReceipt(input: {
  envelope: string;
  expectedStoreId: string;
  expectedTerminalId: string;
  now?: number;
  publicKeys?: readonly PosOfflineAuthorityPublicKey[];
}): Promise<PosOfflineAuthorityReceiptVerification> {
  const now = input.now ?? Date.now();
  const parsed = parseEnvelope(input.envelope);
  if (!parsed) return { status: "rejected", reason: "malformed" };

  const { encodedPayload, payload, signature } = parsed;
  const publicKeys =
    input.publicKeys ?? POS_OFFLINE_AUTHORITY_PUBLIC_KEYS;
  const key = publicKeys.find(
    (candidate) =>
      candidate.keyVersion === payload.keyVersion &&
      candidate.issuer === payload.issuer,
  );
  if (!key) return { status: "rejected", reason: "unknown_key" };
  if (key.state === "revoked") {
    return { status: "rejected", reason: "revoked_key" };
  }
  if (!isP256PublicJwk(key.publicKeyJwk)) {
    return { status: "rejected", reason: "unknown_key" };
  }

  let verified = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      key.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      toArrayBuffer(signature),
      toArrayBuffer(new TextEncoder().encode(encodedPayload)),
    );
  } catch {
    return { status: "rejected", reason: "invalid_signature" };
  }
  if (!verified) {
    return { status: "rejected", reason: "invalid_signature" };
  }
  if (
    payload.storeId !== input.expectedStoreId ||
    payload.terminalId !== input.expectedTerminalId
  ) {
    return { status: "rejected", reason: "scope_mismatch" };
  }
  if (
    !Number.isSafeInteger(now) ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt >
      POS_OFFLINE_AUTHORITY_MAX_LEASE_MS ||
    now < payload.issuedAt ||
    now > payload.expiresAt
  ) {
    return { status: "rejected", reason: "outside_lease" };
  }

  return {
    status: "valid",
    receipt: { envelope: input.envelope, payload, verifiedAt: now },
  };
}

export function isVerifiedPosOfflineAuthorityReceiptCurrent(input: {
  receipt: VerifiedPosOfflineAuthorityReceipt | null | undefined;
  storeId: string;
  terminalId: string;
  now?: number;
}) {
  const receipt = input.receipt;
  const now = input.now ?? Date.now();
  return Boolean(
    receipt &&
      receipt.payload.version === POS_OFFLINE_AUTHORITY_RECEIPT_VERSION &&
      receipt.payload.audience === POS_OFFLINE_AUTHORITY_AUDIENCE &&
      receipt.payload.capabilityId === "pos.application" &&
      receipt.payload.storeId === input.storeId &&
      receipt.payload.terminalId === input.terminalId &&
      Number.isSafeInteger(now) &&
      now >= receipt.payload.issuedAt &&
      now <= receipt.payload.expiresAt,
  );
}

function parseEnvelope(envelope: string): {
  encodedPayload: string;
  payload: PosOfflineAuthorityReceiptPayloadV1;
  signature: Uint8Array;
} | null {
  try {
    const segments = envelope.split(".");
    if (segments.length !== 2 || !segments[0] || !segments[1]) return null;
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(segments[0])),
    );
    if (!isPayloadV1(payload)) return null;
    if (
      encodeBase64Url(
        new TextEncoder().encode(canonicalJsonV1(payload)),
      ) !== segments[0]
    ) {
      return null;
    }
    const signature = decodeBase64Url(segments[1]);
    if (
      signature.byteLength !== 64 ||
      encodeBase64Url(signature) !== segments[1]
    ) {
      return null;
    }
    return { encodedPayload: segments[0], payload, signature };
  } catch {
    return null;
  }
}

function isPayloadV1(value: unknown): value is PosOfflineAuthorityReceiptPayloadV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join("|") !==
    [...PAYLOAD_KEYS].sort().join("|")
  ) {
    return false;
  }
  return (
    payload.version === POS_OFFLINE_AUTHORITY_RECEIPT_VERSION &&
    payload.audience === POS_OFFLINE_AUTHORITY_AUDIENCE &&
    payload.capabilityId === "pos.application" &&
    nonEmptyString(payload.issuer) &&
    nonEmptyString(payload.nonce) &&
    nonEmptyString(payload.storeId) &&
    nonEmptyString(payload.terminalId) &&
    nonEmptyString(payload.servicePrincipalId) &&
    nonEmptyString(payload.servicePrincipalSessionId) &&
    nonEmptyString(payload.posApplicationSessionBindingId) &&
    positiveInteger(payload.keyVersion) &&
    nonNegativeInteger(payload.issuedAt) &&
    nonNegativeInteger(payload.expiresAt) &&
    positiveInteger(payload.principalLifecycleRevision) &&
    positiveInteger(payload.capabilityRevision) &&
    positiveInteger(payload.credentialRevision) &&
    positiveInteger(payload.terminalLifecycleRevision) &&
    positiveInteger(payload.terminalProofRevision)
  );
}

function isP256PublicJwk(value: JsonWebKey) {
  return (
    value.kty === "EC" &&
    value.crv === "P-256" &&
    nonEmptyString(value.x) &&
    nonEmptyString(value.y) &&
    value.d === undefined
  );
}

function canonicalJsonV1(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

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

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
