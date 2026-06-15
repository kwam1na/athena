import { readPosAppShellReadiness } from "@/offline/posAppShellReadiness";

import type {
  PosDrawerAuthorityState,
  PosLocalStaffAuthorityReadiness,
  PosProvisionedTerminalSeed,
  PosTerminalIntegrityState,
} from "./posLocalStore";
import { createPosLocalStore } from "./posLocalStore";
import { readProjectedLocalRegisterModel } from "./localRegisterReader";
import type { PosLocalCashDrawerReadModel } from "./registerReadModel";
import { resolvePosLocalTerminalScope } from "./terminalScope";
import type {
  PosTerminalRuntimeActiveRegisterSessionInput,
  PosTerminalRuntimeAppShellInput,
  PosTerminalRuntimeSnapshotReadiness,
} from "./terminalRuntimeStatus";
import {
  clearSettledRecoverableDrawerAuthorityBlock,
  readLatestRuntimeDrawerAuthorityState,
} from "./drawerAuthorityReconciliation";

type PosLocalRuntimeStore = ReturnType<typeof createPosLocalStore>;

export type PosTerminalRuntimeReadiness = {
  activeRegisterSession: PosTerminalRuntimeActiveRegisterSessionInput | null;
  appShell: PosTerminalRuntimeAppShellInput | null;
  drawerAuthority: PosDrawerAuthorityState | null;
  snapshots: PosTerminalRuntimeSnapshotReadiness;
  staffAuthorityStatus: PosLocalStaffAuthorityReadiness | "unknown";
  terminalIntegrity: PosTerminalIntegrityState | null;
  terminalSeed: PosProvisionedTerminalSeed | null;
};

export function emptyPosTerminalRuntimeReadiness(): PosTerminalRuntimeReadiness {
  return {
    activeRegisterSession: null,
    appShell: null,
    drawerAuthority: null,
    snapshots: {},
    staffAuthorityStatus: "unknown",
    terminalIntegrity: null,
    terminalSeed: null,
  };
}

export async function refreshTerminalRuntimeReadiness(input: {
  store: PosLocalRuntimeStore;
  storeId: string;
  terminalId?: string | null;
  terminalSeed: PosProvisionedTerminalSeed | null;
}): Promise<PosTerminalRuntimeReadiness> {
  const store = input.store as PosLocalRuntimeStore &
    Partial<{
      getStaffAuthorityReadiness: PosLocalRuntimeStore["getStaffAuthorityReadiness"];
      readTerminalIntegrityState: PosLocalRuntimeStore["readTerminalIntegrityState"];
      readRegisterAvailabilitySnapshot: PosLocalRuntimeStore["readRegisterAvailabilitySnapshot"];
      readRegisterCatalogSnapshot: PosLocalRuntimeStore["readRegisterCatalogSnapshot"];
      readRegisterServiceCatalogSnapshot: PosLocalRuntimeStore["readRegisterServiceCatalogSnapshot"];
    }>;
  const readDrawerAuthorityState = (
    input.store as {
      readDrawerAuthorityState?: PosLocalRuntimeStore["readDrawerAuthorityState"];
    }
  ).readDrawerAuthorityState;
  const scope = resolvePosLocalTerminalScope({
    storeId: input.storeId,
    terminalId: input.terminalId,
    terminalSeed: input.terminalSeed,
  });
  const [
    catalog,
    serviceCatalog,
    availability,
    staffAuthority,
    terminalIntegrity,
    appShell,
  ] = await Promise.all([
    store.readRegisterCatalogSnapshot
      ? store.readRegisterCatalogSnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    store.readRegisterServiceCatalogSnapshot
      ? store.readRegisterServiceCatalogSnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    store.readRegisterAvailabilitySnapshot
      ? store.readRegisterAvailabilitySnapshot({ storeId: input.storeId })
      : Promise.resolve({ ok: true as const, value: null }),
    input.terminalId && store.getStaffAuthorityReadiness
      ? store.getStaffAuthorityReadiness({
          storeId: input.storeId,
          terminalId: input.terminalId,
        })
      : Promise.resolve({ ok: true as const, value: "unknown" as const }),
    input.terminalId && store.readTerminalIntegrityState
      ? store.readTerminalIntegrityState({
          storeId: input.storeId,
          terminalId: input.terminalId,
        })
      : Promise.resolve({ ok: true as const, value: null }),
    readPosAppShellReadiness(),
  ]);
  const localRegisterModel =
    input.terminalId && readDrawerAuthorityState
      ? await readProjectedLocalRegisterModel({
          store,
          storeId: input.storeId,
          terminalId: input.terminalId,
          isOnline:
            typeof navigator === "undefined" ? true : navigator.onLine,
        })
      : ({ ok: true, value: null } as const);
  const activeLocalRegisterSessionId =
    localRegisterModel.ok
      ? localRegisterModel.value?.activeRegisterSession?.localRegisterSessionId
      : undefined;
  let drawerAuthority =
    activeLocalRegisterSessionId && readDrawerAuthorityState
      ? await readLatestRuntimeDrawerAuthorityState({
          localRegisterSessionId: activeLocalRegisterSessionId,
          readDrawerAuthorityState,
          storeId: input.storeId,
          terminalIds: scope.terminalIds,
        })
      : ({ ok: true, value: null } as const);
  if (drawerAuthority.ok && drawerAuthority.value && localRegisterModel.ok) {
    const clearResult = await clearSettledRecoverableDrawerAuthorityBlock({
      drawerAuthority: drawerAuthority.value,
      events: localRegisterModel.value?.sourceEvents ?? [],
      store: input.store,
    });
    if (clearResult.ok && clearResult.value) {
      drawerAuthority = { ok: true, value: null };
    }
  }

  return {
    activeRegisterSession:
      localRegisterModel.ok && localRegisterModel.value?.activeRegisterSession
        ? toRuntimeActiveRegisterSession(
            localRegisterModel.value.activeRegisterSession,
          )
        : null,
    appShell,
    drawerAuthority: drawerAuthority.ok ? drawerAuthority.value : null,
    snapshots: {
      ...(catalog.ok && catalog.value
        ? { catalogRefreshedAt: catalog.value.refreshedAt }
        : {}),
      ...(serviceCatalog.ok && serviceCatalog.value
        ? { serviceCatalogRefreshedAt: serviceCatalog.value.refreshedAt }
        : {}),
      ...(availability.ok && availability.value
        ? { availabilityRefreshedAt: availability.value.refreshedAt }
        : {}),
    },
    staffAuthorityStatus: staffAuthority.ok ? staffAuthority.value : "unknown",
    terminalIntegrity: terminalIntegrity.ok ? terminalIntegrity.value : null,
    terminalSeed: input.terminalSeed,
  };
}

function toRuntimeActiveRegisterSession(
  session: PosLocalCashDrawerReadModel,
): PosTerminalRuntimeActiveRegisterSessionInput {
  return {
    ...(session.cloudRegisterSessionId
      ? { cloudRegisterSessionId: session.cloudRegisterSessionId }
      : {}),
    localRegisterSessionId: session.localRegisterSessionId,
    openedAt: session.openedAt,
    ...(session.registerNumber ? { registerNumber: session.registerNumber } : {}),
    status: session.status,
  };
}
