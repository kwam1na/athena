import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import type { UserError } from "~/shared/commandResult";
import { isPosRegisterNumberConflict } from "~/shared/posTerminalRegistrationError";

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

export function resolveSharedDemoRestoreBootstrapStatus(
  status?: "failed" | "ready" | "restoring",
): "failed" | "ready" | "waiting" {
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  return "waiting";
}

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

const SHARED_DEMO_REGISTER_NUMBER_COUNT = 98;
const SHARED_DEMO_FIRST_BROWSER_REGISTER_NUMBER = 2;
type SharedDemoRegisterProvisionResult<TData> =
  | { kind: "ok"; data: TData }
  | {
      kind: "user_error";
      error: Pick<UserError, "code" | "message" | "metadata">;
    };

export function getSharedDemoRegisterNumberCandidates(fingerprintHash: string) {
  const fingerprintPrefix = fingerprintHash.slice(0, 6);
  const numericFingerprint = Number.parseInt(fingerprintPrefix, 16);
  const initialRegisterIndex = Number.isFinite(numericFingerprint)
    ? numericFingerprint % SHARED_DEMO_REGISTER_NUMBER_COUNT
    : 0;

  return Array.from(
    { length: SHARED_DEMO_REGISTER_NUMBER_COUNT },
    (_, offset) =>
      String(
        ((initialRegisterIndex + offset) %
          SHARED_DEMO_REGISTER_NUMBER_COUNT) +
          SHARED_DEMO_FIRST_BROWSER_REGISTER_NUMBER,
      ).padStart(2, "0"),
  );
}

export function getSharedDemoRegisterNumber(fingerprintHash: string) {
  return getSharedDemoRegisterNumberCandidates(fingerprintHash)[0] ?? "02";
}

export function isSharedDemoRegisterNumber(
  registerNumber?: string | null,
) {
  return /^(?:0[2-9]|[1-9]\d)$/.test(registerNumber ?? "");
}

export async function provisionSharedDemoRegister<TData>(input: {
  fingerprintHash: string;
  provision: (
    registerNumber: string,
  ) => Promise<SharedDemoRegisterProvisionResult<TData>>;
}): Promise<SharedDemoRegisterProvisionResult<TData>> {
  for (const registerNumber of getSharedDemoRegisterNumberCandidates(
    input.fingerprintHash,
  )) {
    const result = await input.provision(registerNumber);
    if (
      result.kind === "ok" ||
      !isPosRegisterNumberConflict(result.error)
    ) {
      return result;
    }
  }

  return {
    kind: "user_error",
    error: {
      code: "unavailable",
      message: "No two-digit register numbers are available in this demo store.",
    },
  };
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
