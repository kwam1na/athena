import type {
  PosLocalRegisterServiceCatalogSnapshot,
  PosLocalStoreResult,
} from "./posLocalStore";

export const REGISTER_SERVICE_CATALOG_SNAPSHOT_MAX_AGE_MS =
  24 * 60 * 60 * 1_000;

type RegisterServiceCatalogSnapshotReader = {
  readRegisterServiceCatalogSnapshot(input: {
    storeId: string;
  }): Promise<
    PosLocalStoreResult<PosLocalRegisterServiceCatalogSnapshot | null>
  >;
};

export type RegisterServiceCatalogSnapshotState =
  | {
      status: "ready";
      snapshot: PosLocalRegisterServiceCatalogSnapshot;
    }
  | {
      status: "missing";
      snapshot: null;
    }
  | {
      status: "stale";
      snapshot: PosLocalRegisterServiceCatalogSnapshot;
    }
  | {
      error: Extract<PosLocalStoreResult<never>, { ok: false }>["error"];
      status: "local-store-failure";
      snapshot: null;
    };

export async function readRegisterServiceCatalogSnapshotState(input: {
  maxAgeMs?: number;
  now?: number;
  store: RegisterServiceCatalogSnapshotReader;
  storeId: string;
}): Promise<RegisterServiceCatalogSnapshotState> {
  const result = await input.store.readRegisterServiceCatalogSnapshot({
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

  const maxAgeMs =
    input.maxAgeMs ?? REGISTER_SERVICE_CATALOG_SNAPSHOT_MAX_AGE_MS;
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
