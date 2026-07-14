import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";

type SharedDemoLocalResetStore = {
  resetSharedDemoFirstVisitState?: () => Promise<
    | { ok: true; value: null }
    | { ok: false; error: { message: string } }
  >;
};

type SharedDemoBrowserStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function getSharedDemoRestoreEpochStorageKey(storeId: string) {
  return `athena:shared-demo:restore-epoch:v5:${storeId}`;
}

export async function resetSharedDemoFirstVisitBrowserState(input: {
  localStore: SharedDemoLocalResetStore;
  storage: SharedDemoBrowserStorage;
  storeId: string;
}) {
  const reset = await input.localStore.resetSharedDemoFirstVisitState?.();
  if (!reset) {
    throw new Error("Demo browser data could not be reset.");
  }
  if (!reset.ok) throw new Error(reset.error.message);

  input.storage.removeItem(
    getSharedDemoRestoreEpochStorageKey(input.storeId),
  );
  input.storage.removeItem(FINGERPRINT_STORAGE_KEY);
}

export function getSharedDemoRegisterNumber(fingerprintHash: string) {
  const fingerprintPrefix = fingerprintHash.slice(0, 6);
  const numericFingerprint = Number.parseInt(fingerprintPrefix, 16);
  const stableRegisterNumber = Number.isFinite(numericFingerprint)
    ? (numericFingerprint % 900_000) + 100_000
    : 100_000;

  return String(stableRegisterNumber);
}

const SHARED_DEMO_TERMINAL_NAMES = [
  "Scan Solo",
  "The Tilluminati",
  "Receipt Raccoon",
  "Cashanova",
  "Sir Scans-a-Lot",
  "Drawer McDrawerface",
  "Counter Culture",
  "Barcode Bandit",
  "Change Agent",
  "Ctrl Alt Receipt",
  "Till Swift",
  "The Checkout Whisperer",
] as const;

export function getSharedDemoTerminalName(fingerprintHash: string) {
  const fingerprintPrefix = fingerprintHash.slice(0, 8);
  const numericFingerprint = Number.parseInt(fingerprintPrefix, 16);
  const terminalNameIndex = Number.isFinite(numericFingerprint)
    ? numericFingerprint % SHARED_DEMO_TERMINAL_NAMES.length
    : 0;

  return SHARED_DEMO_TERMINAL_NAMES[terminalNameIndex];
}

export function planSharedDemoLocalBootstrap(input: {
  currentEpoch: number;
  hasMatchingRegisterNumber: boolean;
  hasMatchingTerminalSeed: boolean;
  hasTerminalSeed: boolean;
  priorEpoch: number | null;
}) {
  const resetOperationalState =
    (input.priorEpoch === null
      ? input.hasTerminalSeed
      : input.priorEpoch !== input.currentEpoch) ||
    (input.hasTerminalSeed && !input.hasMatchingTerminalSeed) ||
    (input.hasMatchingTerminalSeed && !input.hasMatchingRegisterNumber);

  const provisionTerminal =
    !input.hasMatchingTerminalSeed || !input.hasMatchingRegisterNumber;

  return {
    bindRegisterBaseline: provisionTerminal || resetOperationalState,
    provisionTerminal,
    resetOperationalState,
  };
}

export function resolveSharedDemoRegisterBootstrapAction(input: {
  bindRegisterBaseline: boolean;
  hasUsableLocalSession: boolean;
}): "bind" | "preserve" | "reuse" {
  if (input.bindRegisterBaseline) return "bind";
  return input.hasUsableLocalSession ? "reuse" : "preserve";
}
