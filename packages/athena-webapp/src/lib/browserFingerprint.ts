export type BrowserInfo = {
  userAgent: string;
  platform?: string;
  language?: string;
  vendor?: string;
  screenResolution?: string;
  colorDepth?: number;
};

export type BrowserFingerprintResult = {
  fingerprintHash: string;
  browserInfo: BrowserInfo;
};

const textEncoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function bufferToHex(buffer: ArrayBuffer): string {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function collectBrowserInfo(): BrowserInfo {
  if (typeof window === "undefined") {
    throw new Error("Browser fingerprinting is only available in the browser.");
  }

  const { navigator, screen } = window;

  const resolution =
    screen && screen.width && screen.height
      ? `${screen.width}x${screen.height}`
      : undefined;

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || undefined,
    language: navigator.language || navigator.languages?.[0],
    vendor: navigator.vendor || undefined,
    screenResolution: resolution,
    colorDepth: screen?.colorDepth,
  };
}

async function hashFingerprintSource(source: string): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Browser fingerprinting is only available in the browser.");
  }

  if (window.crypto?.subtle && textEncoder) {
    const data = textEncoder.encode(source);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    return bufferToHex(hashBuffer);
  }

  // Basic fallback hash when SubtleCrypto is unavailable
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

export async function generateBrowserFingerprint(): Promise<BrowserFingerprintResult> {
  const info = collectBrowserInfo();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const devicePixelRatio =
    typeof window !== "undefined" ? (window.devicePixelRatio ?? "") : "";
  const hardwareConcurrency =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency.toString()
      : "";
  const deviceMemory =
    typeof (navigator as any).deviceMemory === "number"
      ? (navigator as any).deviceMemory.toString()
      : "";

  const fingerprintSource = [
    info.userAgent,
    info.platform ?? "",
    info.language ?? "",
    info.vendor ?? "",
    info.screenResolution ?? "",
    info.colorDepth?.toString() ?? "",
    timezone ?? "",
    devicePixelRatio?.toString() ?? "",
    hardwareConcurrency,
    deviceMemory,
  ].join("::");

  const fingerprintHash = await hashFingerprintSource(fingerprintSource);

  return {
    fingerprintHash,
    browserInfo: info,
  };
}
