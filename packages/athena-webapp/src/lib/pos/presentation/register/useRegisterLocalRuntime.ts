import { useCallback, useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";

import type { Id } from "~/convex/_generated/dataModel";

import { useOptionalUpdateCoordinator } from "@/lib/app-update/UpdateCoordinatorProvider";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalEventValidationMetadata,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { createLocalCommandGateway } from "@/lib/pos/infrastructure/local/localCommandGateway";
import { readProjectedLocalRegisterModel } from "@/lib/pos/infrastructure/local/localRegisterReader";
import type { PosLocalRegisterReadModel } from "@/lib/pos/infrastructure/local/registerReadModel";
import { usePosLocalSyncRuntimeStatus } from "@/lib/pos/infrastructure/local/usePosLocalSyncRuntime";
import { usePosTerminalAppSessionRecoveryRuntimeInput } from "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext";

type RegisterLocalRuntimeTerminal = Parameters<
  typeof readProjectedLocalRegisterModel
>[0]["terminal"];

type RegisterLocalStore = ReturnType<typeof createPosLocalStore>;
type RegisterLocalCommandGateway = ReturnType<typeof createLocalCommandGateway>;

function buildLocalSaleValidationMetadata(
  appSessionRecoveryStatus?: string | null,
): PosLocalEventValidationMetadata | undefined {
  if (
    !appSessionRecoveryStatus ||
    appSessionRecoveryStatus === "idle" ||
    appSessionRecoveryStatus === "recoverable"
  ) {
    return undefined;
  }

  return {
    flags: ["app-session-unverified", "cloud-validation-uncertain"],
    observedAt: Date.now(),
    uploadDeferredUntil: "app-session-validated",
  };
}

export function useRegisterLocalRuntime(input: {
  activeStoreId?: Id<"store">;
  createLocalFallbackId: (prefix: string) => string;
  onRetryBootstrap: () => void;
  staffProfileId: Id<"staffProfile"> | null;
  staffProfileIdRef: MutableRefObject<Id<"staffProfile"> | null>;
  staffProofToken: string | null;
  staffProofTokenRef: MutableRefObject<string | null>;
  terminal?: RegisterLocalRuntimeTerminal | null;
}): {
  appSessionRecovery: ReturnType<
    typeof usePosTerminalAppSessionRecoveryRuntimeInput
  >;
  hasProvisionedLocalSyncSeed: () => Promise<boolean>;
  localCommandGateway: RegisterLocalCommandGateway;
  localRegisterReadModel: PosLocalRegisterReadModel | null;
  localRuntimeSyncSource: ReturnType<typeof usePosLocalSyncRuntimeStatus>;
  localSaleValidationMetadata: PosLocalEventValidationMetadata | undefined;
  localStaffAuthorityStatus: string;
  localStore: RegisterLocalStore;
  localSyncEventAppendToken: number;
  noteLocalRegisterEventChanged: () => void;
  noteLocalRuntimeChanged: () => void;
  readCurrentLocalRegisterModel: () => Promise<PosLocalRegisterReadModel | null>;
  refreshLocalRegisterReadModel: () => Promise<void>;
} {
  const {
    activeStoreId,
    createLocalFallbackId,
    onRetryBootstrap,
    staffProfileId,
    staffProfileIdRef,
    staffProofToken,
    staffProofTokenRef,
    terminal,
  } = input;
  const [localRegisterReadModel, setLocalRegisterReadModel] =
    useState<PosLocalRegisterReadModel | null>(null);
  const [localRegisterReadModelVersion, setLocalRegisterReadModelVersion] =
    useState(0);
  const [localSyncEventAppendToken, setLocalSyncEventAppendToken] = useState(0);
  const [localStaffAuthorityStatus, setLocalStaffAuthorityStatus] =
    useState("unknown");

  const localStore = useMemo(
    () =>
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }),
    [],
  );

  const noteLocalRegisterEventChanged = useCallback(() => {
    setLocalRegisterReadModelVersion((current) => current + 1);
  }, []);

  const noteLocalEventAppended = useCallback(() => {
    setLocalSyncEventAppendToken((current) => current + 1);
  }, []);

  const noteLocalRuntimeChanged = useCallback(() => {
    setLocalRegisterReadModelVersion((current) => current + 1);
    setLocalSyncEventAppendToken((current) => current + 1);
  }, []);

  const localCommandGateway = useMemo(
    () =>
      createLocalCommandGateway({
        allowExplicitRegisterSessionWithoutProjection: true,
        store: localStore,
        createLocalId: (kind) => {
          if (kind === "local-register-session" && terminal?._id) {
            return createLocalFallbackId(`local-register-${terminal._id}`);
          }
          return createLocalFallbackId(kind);
        },
        onEventAppended: noteLocalEventAppended,
        staffProofToken: (requestedStaffProfileId) =>
          requestedStaffProfileId === staffProfileIdRef.current
            ? (staffProofTokenRef.current ?? undefined)
            : undefined,
      }),
    [
      createLocalFallbackId,
      localStore,
      noteLocalEventAppended,
      staffProfileIdRef,
      staffProofTokenRef,
      terminal?._id,
    ],
  );

  const appSessionRecovery = usePosTerminalAppSessionRecoveryRuntimeInput();
  const updateCoordinator = useOptionalUpdateCoordinator();
  const appUpdateCoordinator = useMemo(
    () =>
      updateCoordinator
        ? {
            applyUpdate: updateCoordinator.applyUpdate,
            getSnapshot: updateCoordinator.getSnapshot,
          }
        : null,
    [updateCoordinator],
  );
  const localSaleValidationMetadata = useMemo(
    () => buildLocalSaleValidationMetadata(appSessionRecovery?.status),
    [appSessionRecovery?.status],
  );

  useEffect(() => {
    if (!staffProfileId || !staffProofToken) {
      return;
    }

    void localStore
      .attachStaffProofTokenToPendingEvents({
        staffProfileId,
        staffProofToken,
      })
      .then((result) => {
        if (result.ok && result.value > 0) {
          noteLocalEventAppended();
        }
      });
  }, [localStore, noteLocalEventAppended, staffProfileId, staffProofToken]);

  useEffect(() => {
    let cancelled = false;

    async function refreshLocalStaffAuthorityStatus() {
      if (
        !activeStoreId ||
        !terminal?._id ||
        typeof indexedDB === "undefined"
      ) {
        setLocalStaffAuthorityStatus("unavailable");
        return;
      }

      try {
        const result = await localStore.getStaffAuthorityReadiness({
          storeId: activeStoreId,
          terminalId: terminal._id,
        });
        if (!cancelled) {
          setLocalStaffAuthorityStatus(
            result.ok ? result.value : "unavailable",
          );
        }
      } catch {
        if (!cancelled) {
          setLocalStaffAuthorityStatus("unavailable");
        }
      }
    }

    void refreshLocalStaffAuthorityStatus();

    return () => {
      cancelled = true;
    };
  }, [activeStoreId, localStore, terminal?._id, staffProfileId]);

  const hasProvisionedLocalSyncSeed = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
      return false;
    }

    const result = await localStore.readProvisionedTerminalSeed();

    return Boolean(
      result.ok &&
        result.value &&
        result.value.storeId === activeStoreId &&
        result.value.cloudTerminalId === terminal._id &&
        result.value.syncSecretHash,
    );
  }, [activeStoreId, localStore, terminal?._id]);

  const readCurrentLocalRegisterModel = useCallback(async () => {
    if (!activeStoreId || !terminal?._id || typeof indexedDB === "undefined") {
      return null;
    }

    if (
      typeof localStore.listEvents !== "function" ||
      typeof localStore.readProvisionedTerminalSeed !== "function"
    ) {
      return null;
    }

    const model = await readProjectedLocalRegisterModel({
      store: localStore,
      storeId: activeStoreId,
      terminal,
      isOnline: globalThis.navigator?.onLine ?? false,
    });
    return model.ok ? model.value : null;
  }, [activeStoreId, localStore, terminal]);

  const refreshLocalRegisterReadModel = useCallback(async () => {
    const model = await readCurrentLocalRegisterModel();
    setLocalRegisterReadModel(model);
  }, [readCurrentLocalRegisterModel]);

  useEffect(() => {
    void refreshLocalRegisterReadModel();
  }, [localRegisterReadModelVersion, refreshLocalRegisterReadModel]);

  const localRuntimeStoreFactory = useCallback(() => localStore, [localStore]);
  const localRuntimeSyncSource = usePosLocalSyncRuntimeStatus({
    appUpdateCoordinator,
    appSessionRecovery,
    drainOnAppend: true,
    eventAppendToken: localSyncEventAppendToken,
    mode: "status-only",
    onLocalEventsChanged: noteLocalRegisterEventChanged,
    storeId: activeStoreId,
    staffProfileId,
    terminalId: terminal?._id,
    onRetrySync: onRetryBootstrap,
    storeFactory: localRuntimeStoreFactory,
  });

  return {
    appSessionRecovery,
    hasProvisionedLocalSyncSeed,
    localCommandGateway,
    localRegisterReadModel,
    localRuntimeSyncSource,
    localSaleValidationMetadata,
    localStaffAuthorityStatus,
    localStore,
    localSyncEventAppendToken,
    noteLocalRegisterEventChanged,
    noteLocalRuntimeChanged,
    readCurrentLocalRegisterModel,
    refreshLocalRegisterReadModel,
  };
}
