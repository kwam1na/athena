/**
 * Fixed application-wide salt for PIN hashing
 * This prevents rainbow table attacks while maintaining deterministic hashing
 */
const PIN_SALT = "athena-pos-cashier-pin-salt-v1";

/**
 * Hash a PIN using SHA-256 with a fixed salt
 * @param pin - The plaintext PIN (should be validated as 6 digits before calling)
 * @returns The SHA-256 hash of the PIN as a hex string
 */
export async function hashPin(pin: string): Promise<string> {
  // Combine PIN with fixed salt
  const saltedPin = `${PIN_SALT}${pin}`;

  // Convert string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(saltedPin);

  // Hash using SHA-256
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert hash to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex;
}
