export const POS_RECOVERY_KEYED_VERIFIER_VERSION = 1;
export const POS_RECOVERY_PBKDF2_ITERATIONS = 600_000;

const PEPPERS_ENV = "POS_RECOVERY_CODE_PEPPERS_JSON";
const ACTIVE_PEPPER_VERSION_ENV =
  "POS_RECOVERY_CODE_ACTIVE_PEPPER_VERSION";
const MINIMUM_PEPPER_LENGTH = 32;

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("The POS recovery verifier configuration is invalid.");
  }
  return Uint8Array.from(
    hex.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
}

function readPepperConfig() {
  const activeVersion = Number.parseInt(
    process.env[ACTIVE_PEPPER_VERSION_ENV] ?? "",
    10,
  );
  let peppers: Record<string, unknown>;
  try {
    peppers = JSON.parse(process.env[PEPPERS_ENV] ?? "") as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("The POS recovery verifier is not configured.");
  }
  if (!Number.isSafeInteger(activeVersion) || activeVersion < 1) {
    throw new Error("The POS recovery verifier is not configured.");
  }
  return { activeVersion, peppers };
}

function requirePepper(version: number) {
  const { peppers } = readPepperConfig();
  const pepper = peppers[String(version)];
  if (typeof pepper !== "string" || pepper.length < MINIMUM_PEPPER_LENGTH) {
    throw new Error("The POS recovery verifier is not configured.");
  }
  return pepper;
}

async function deriveDigest(input: {
  iterations: number;
  normalizedCode: string;
  pepper: string;
  saltHex: string;
}) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${input.pepper}:${input.normalizedCode}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: input.iterations,
      salt: hexToBytes(input.saltHex),
    },
    key,
    256,
  );
  return bytesToHex(digest);
}

export async function createPosRecoveryCodeVerifier(input: {
  normalizedCode: string;
  saltHex: string;
}) {
  const { activeVersion } = readPepperConfig();
  return {
    digest: await deriveDigest({
      iterations: POS_RECOVERY_PBKDF2_ITERATIONS,
      normalizedCode: input.normalizedCode,
      pepper: requirePepper(activeVersion),
      saltHex: input.saltHex,
    }),
    iterations: POS_RECOVERY_PBKDF2_ITERATIONS,
    pepperVersion: activeVersion,
    saltHex: input.saltHex,
    verifierVersion: POS_RECOVERY_KEYED_VERIFIER_VERSION,
  };
}

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyPosRecoveryCodeVerifier(input: {
  digest: string;
  iterations: number;
  normalizedCode: string;
  pepperVersion: number;
  saltHex: string;
  verifierVersion: number;
}) {
  if (
    input.verifierVersion !== POS_RECOVERY_KEYED_VERIFIER_VERSION ||
    input.iterations !== POS_RECOVERY_PBKDF2_ITERATIONS
  ) {
    return false;
  }
  const digest = await deriveDigest({
    iterations: input.iterations,
    normalizedCode: input.normalizedCode,
    pepper: requirePepper(input.pepperVersion),
    saltHex: input.saltHex,
  });
  return constantTimeHexEqual(digest, input.digest);
}
