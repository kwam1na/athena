import type { PosProvisionedTerminalSeed } from "./posLocalStoreTypes";

export const POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY =
  "athena.posTerminalReconnectIntent.v1";

export type PosTerminalReconnectIntent = {
  expiresAt: number;
  reconnectIntentToken: string;
  version: 1;
};

export function writePosTerminalReconnectIntent(
  input: Omit<PosTerminalReconnectIntent, "version">,
  options: { now?: number; storage?: Storage } = {},
) {
  const now = options.now ?? Date.now();
  const storage = options.storage ?? getSessionStorage();
  if (
    !storage ||
    !isOpaqueIntentToken(input.reconnectIntentToken) ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= now
  ) {
    return false;
  }

  storage.setItem(
    POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY,
    JSON.stringify({ ...input, version: 1 }),
  );
  return true;
}

export function readPosTerminalReconnectIntent(
  options: { now?: number; storage?: Storage } = {},
): PosTerminalReconnectIntent | null {
  const now = options.now ?? Date.now();
  const storage = options.storage ?? getSessionStorage();
  if (!storage) return null;

  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      Object.keys(value).sort().join("|") !==
        "expiresAt|reconnectIntentToken|version" ||
      value.version !== 1 ||
      !isOpaqueIntentToken(value.reconnectIntentToken) ||
      !Number.isSafeInteger(value.expiresAt) ||
      Number(value.expiresAt) <= now
    ) {
      storage.removeItem(POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY);
      return null;
    }
    return value as PosTerminalReconnectIntent;
  } catch {
    storage.removeItem(POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY);
    return null;
  }
}

export function clearPosTerminalReconnectIntent(
  expectedToken?: string,
  storage: Storage | undefined = getSessionStorage(),
) {
  if (!storage) return;
  if (expectedToken) {
    const current = readPosTerminalReconnectIntent({ storage });
    if (current?.reconnectIntentToken !== expectedToken) return;
  }
  storage.removeItem(POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY);
}

export function getPosTerminalReconnectSettingsRedirect(
  seed: PosProvisionedTerminalSeed | null | undefined,
) {
  if (
    !seed?.orgUrlSlug ||
    !seed.storeUrlSlug ||
    !readPosTerminalReconnectIntent()
  ) {
    return undefined;
  }
  return `/${encodeURIComponent(seed.orgUrlSlug)}/store/${encodeURIComponent(seed.storeUrlSlug)}/pos/settings?reconnect=current-station`;
}

function isOpaqueIntentToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function getSessionStorage() {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
