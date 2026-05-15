import type {
  PosLocalRegisterAvailabilitySnapshot,
  PosLocalStoreResult,
} from "./posLocalStore";

export const REGISTER_AVAILABILITY_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type RegisterAvailabilitySnapshotReader = {
  readRegisterAvailabilitySnapshot(input: {
    storeId: string;
  }): Promise<PosLocalStoreResult<PosLocalRegisterAvailabilitySnapshot | null>>;
};

export type RegisterAvailabilitySnapshotState =
  | {
      status: "ready";
      snapshot: PosLocalRegisterAvailabilitySnapshot;
    }
  | {
      status: "missing";
      snapshot: null;
    }
  | {
      status: "stale";
      snapshot: PosLocalRegisterAvailabilitySnapshot;
    }
  | {
      error: Extract<PosLocalStoreResult<never>, { ok: false }>["error"];
      status: "local-store-failure";
      snapshot: null;
    };

export async function readRegisterAvailabilitySnapshotState(input: {
  maxAgeMs?: number;
  now?: number;
  store: RegisterAvailabilitySnapshotReader;
  storeId: string;
}): Promise<RegisterAvailabilitySnapshotState> {
  const result = await input.store.readRegisterAvailabilitySnapshot({
    storeId: input.storeId,
  });

  if (!result.ok) {
    return {
      error: result.error,
      status: "local-store-failure",
      snapshot: null,
    };
  }

  if (!result.value) {
    return {
      status: "missing",
      snapshot: null,
    };
  }

  const maxAgeMs = input.maxAgeMs ?? REGISTER_AVAILABILITY_SNAPSHOT_MAX_AGE_MS;
  const now = input.now ?? Date.now();

  if (now - result.value.refreshedAt > maxAgeMs) {
    return {
      status: "stale",
      snapshot: result.value,
    };
  }

  return {
    status: "ready",
    snapshot: result.value,
  };
}
