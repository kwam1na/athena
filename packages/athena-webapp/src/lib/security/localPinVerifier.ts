export const LOCAL_PIN_VERIFIER_VERSION = 1;
export const LOCAL_PIN_VERIFIER_ALGORITHM = "PBKDF2-SHA256";
export const LOCAL_PIN_VERIFIER_ITERATIONS = 120_000;

export type LocalPinVerifierMetadata = {
  algorithm: typeof LOCAL_PIN_VERIFIER_ALGORITHM;
  hash: string;
  iterations: number;
  salt: string;
  version: typeof LOCAL_PIN_VERIFIER_VERSION;
};

export type LocalPinVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_pin" | "malformed_verifier" | "unsupported_verifier";
    };

export type WrappedLocalStaffProof = {
  ciphertext: string;
  expiresAt: number;
  iv: string;
};

const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;
const AES_GCM_IV_BYTES = 12;

function getCrypto() {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.subtle || !cryptoRef.getRandomValues) {
    throw new Error("Local PIN verification is unavailable in this browser.");
  }
  return cryptoRef;
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  throw new Error("Base64 encoding is unavailable in this runtime.");
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    return null;
  } catch {
    return null;
  }
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

async function derivePinHash(input: {
  iterations: number;
  pin: string;
  salt: Uint8Array;
}) {
  const cryptoRef = getCrypto();
  const keyMaterial = await cryptoRef.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await cryptoRef.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: input.salt as unknown as BufferSource,
      iterations: input.iterations,
    },
    keyMaterial,
    KEY_LENGTH_BITS,
  );

  return bytesToBase64(new Uint8Array(derivedBits));
}

async function deriveWrappingKey(input: {
  iterations: number;
  pin: string;
  salt: Uint8Array;
}) {
  const cryptoRef = getCrypto();
  const keyMaterial = await cryptoRef.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return cryptoRef.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: input.salt as unknown as BufferSource,
      iterations: input.iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createLocalPinVerifier(
  pin: string,
): Promise<LocalPinVerifierMetadata> {
  const cryptoRef = getCrypto();
  const salt = new Uint8Array(SALT_BYTES);
  cryptoRef.getRandomValues(salt);
  const hash = await derivePinHash({
    iterations: LOCAL_PIN_VERIFIER_ITERATIONS,
    pin,
    salt,
  });

  return {
    algorithm: LOCAL_PIN_VERIFIER_ALGORITHM,
    hash,
    iterations: LOCAL_PIN_VERIFIER_ITERATIONS,
    salt: bytesToBase64(salt),
    version: LOCAL_PIN_VERIFIER_VERSION,
  };
}

export async function verifyLocalPin(
  verifier: unknown,
  pin: string,
): Promise<LocalPinVerificationResult> {
  if (!isLocalPinVerifierMetadata(verifier)) {
    return { ok: false, reason: "malformed_verifier" };
  }

  if (
    verifier.version !== LOCAL_PIN_VERIFIER_VERSION ||
    verifier.algorithm !== LOCAL_PIN_VERIFIER_ALGORITHM
  ) {
    return { ok: false, reason: "unsupported_verifier" };
  }

  const salt = base64ToBytes(verifier.salt);
  if (!salt || salt.length === 0 || verifier.iterations <= 0) {
    return { ok: false, reason: "malformed_verifier" };
  }

  const hash = await derivePinHash({
    iterations: verifier.iterations,
    pin,
    salt,
  });

  return timingSafeEqual(hash, verifier.hash)
    ? { ok: true }
    : { ok: false, reason: "invalid_pin" };
}

export async function wrapLocalStaffProofToken(
  verifier: LocalPinVerifierMetadata,
  pin: string,
  proof: { expiresAt: number; token: string },
): Promise<WrappedLocalStaffProof | null> {
  if (
    verifier.version !== LOCAL_PIN_VERIFIER_VERSION ||
    verifier.algorithm !== LOCAL_PIN_VERIFIER_ALGORITHM
  ) {
    return null;
  }

  const salt = base64ToBytes(verifier.salt);
  if (!salt || salt.length === 0 || verifier.iterations <= 0) {
    return null;
  }

  const cryptoRef = getCrypto();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  cryptoRef.getRandomValues(iv);
  const key = await deriveWrappingKey({
    iterations: verifier.iterations,
    pin,
    salt,
  });
  const ciphertext = await cryptoRef.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(proof.token),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    expiresAt: proof.expiresAt,
    iv: bytesToBase64(iv),
  };
}

export async function unwrapLocalStaffProofToken(
  verifier: LocalPinVerifierMetadata,
  pin: string,
  wrappedProof: WrappedLocalStaffProof | undefined,
): Promise<{ expiresAt: number; token: string } | null> {
  if (!wrappedProof) {
    return null;
  }

  if (
    verifier.version !== LOCAL_PIN_VERIFIER_VERSION ||
    verifier.algorithm !== LOCAL_PIN_VERIFIER_ALGORITHM
  ) {
    return null;
  }

  const salt = base64ToBytes(verifier.salt);
  const iv = base64ToBytes(wrappedProof.iv);
  const ciphertext = base64ToBytes(wrappedProof.ciphertext);
  if (
    !salt ||
    salt.length === 0 ||
    !iv ||
    iv.length === 0 ||
    !ciphertext ||
    ciphertext.length === 0 ||
    verifier.iterations <= 0
  ) {
    return null;
  }

  try {
    const key = await deriveWrappingKey({
      iterations: verifier.iterations,
      pin,
      salt,
    });
    const plaintext = await cryptoRefDecrypt(key, iv, ciphertext);
    return {
      expiresAt: wrappedProof.expiresAt,
      token: new TextDecoder().decode(plaintext),
    };
  } catch {
    return null;
  }
}

async function cryptoRefDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
) {
  const cryptoRef = getCrypto();
  return cryptoRef.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );
}

export function isLocalPinVerifierMetadata(
  value: unknown,
): value is LocalPinVerifierMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.algorithm === "string" &&
    typeof candidate.hash === "string" &&
    typeof candidate.iterations === "number" &&
    Number.isSafeInteger(candidate.iterations) &&
    typeof candidate.salt === "string" &&
    typeof candidate.version === "number" &&
    Number.isSafeInteger(candidate.version)
  );
}
