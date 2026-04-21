import type { BrowserFingerprintResult } from "@/lib/browserFingerprint";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";

function isBrowserFingerprintResult(
  value: unknown,
): value is BrowserFingerprintResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BrowserFingerprintResult>;

  return (
    typeof candidate.fingerprintHash === "string" &&
    !!candidate.browserInfo &&
    typeof candidate.browserInfo === "object"
  );
}

export function readStoredTerminalFingerprint():
  | BrowserFingerprintResult
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);

    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue) as unknown;

    return isBrowserFingerprintResult(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

export function readStoredTerminalFingerprintHash(): string | null {
  return readStoredTerminalFingerprint()?.fingerprintHash ?? null;
}
