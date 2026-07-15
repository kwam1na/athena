export function createOpaqueTicket() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function hashSharedDemoTicket(ticket: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ticket),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
