export async function hashPassword(password: string, salt: string) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 }, // or whatever algorithm you need
    true,
    ["encrypt", "decrypt"]
  );

  const exportedKey = await window.crypto.subtle.exportKey("raw", derivedKey);
  return Buffer.from(exportedKey).toString("hex");
}
