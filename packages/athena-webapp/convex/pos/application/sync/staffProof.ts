const TOKEN_BYTES = 24;
export const POS_LOCAL_STAFF_PROOF_TTL_MS = 12 * 60 * 60 * 1000;

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createPosLocalStaffProofToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashPosLocalStaffProofToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  return toHex(digest);
}
