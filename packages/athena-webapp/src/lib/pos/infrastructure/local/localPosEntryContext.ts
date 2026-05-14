import { useEffect, useMemo, useState } from "react";

import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalStoreResult,
  type PosProvisionedTerminalSeed,
} from "./posLocalStore";

export type PosLocalEntryRouteParams = {
  orgUrlSlug?: string;
  storeUrlSlug?: string;
};

export type PosLocalEntryStore = {
  _id?: string;
  slug?: string;
} | null;

export type PosLocalEntryOrganization = {
  slug?: string;
} | null;

export type PosLocalEntryContext =
  | { status: "loading" }
  | {
      status: "ready";
      orgUrlSlug: string;
      storeUrlSlug: string;
      storeId: string;
      terminalSeed: PosProvisionedTerminalSeed | null;
      source: "live" | "local";
    }
  | { status: "missing_seed" }
  | {
      status: "mismatched_store";
      expectedStoreId: string;
      seedStoreId: string;
    }
  | { status: "missing_route" }
  | {
      status: "unsupported_schema";
      message: string;
    };

type SeedReadState =
  | { status: "loading" }
  | PosLocalStoreResult<PosProvisionedTerminalSeed | null>;

export function resolveLocalPosEntryContext(input: {
  activeOrganization?: PosLocalEntryOrganization;
  activeStore?: PosLocalEntryStore;
  routeParams?: PosLocalEntryRouteParams;
  seedRead: SeedReadState;
}): PosLocalEntryContext {
  const activeStore = input.activeStore ?? null;
  const activeOrganization = input.activeOrganization ?? null;
  const routeParams = input.routeParams ?? {};
  const orgUrlSlug = activeOrganization?.slug ?? routeParams.orgUrlSlug;
  const storeUrlSlug = activeStore?.slug ?? routeParams.storeUrlSlug;

  if (isSeedReadLoading(input.seedRead)) {
    if (activeStore?._id && orgUrlSlug && storeUrlSlug) {
      return {
        status: "ready",
        orgUrlSlug,
        storeUrlSlug,
        storeId: activeStore._id,
        terminalSeed: null,
        source: "live",
      };
    }

    return { status: "loading" };
  }

  if (!input.seedRead.ok) {
    if (input.seedRead.error.code === "unsupported_schema_version") {
      return {
        status: "unsupported_schema",
        message: input.seedRead.error.message,
      };
    }

    return { status: "missing_seed" };
  }

  const terminalSeed = input.seedRead.value;

  if (
    terminalSeed &&
    activeStore?._id &&
    terminalSeed.storeId !== activeStore._id
  ) {
    return {
      status: "mismatched_store",
      expectedStoreId: activeStore._id,
      seedStoreId: terminalSeed.storeId,
    };
  }

  if (activeStore?._id && orgUrlSlug && storeUrlSlug) {
    return {
      status: "ready",
      orgUrlSlug,
      storeUrlSlug,
      storeId: activeStore._id,
      terminalSeed,
      source: "live",
    };
  }

  if (!terminalSeed) {
    return { status: "missing_seed" };
  }

  if (!orgUrlSlug || !storeUrlSlug) {
    return { status: "missing_route" };
  }

  return {
    status: "ready",
    orgUrlSlug,
    storeUrlSlug,
    storeId: terminalSeed.storeId,
    terminalSeed,
    source: "local",
  };
}

function isSeedReadLoading(
  seedRead: SeedReadState,
): seedRead is { status: "loading" } {
  return "status" in seedRead && seedRead.status === "loading";
}

export function useLocalPosEntryContext(input: {
  activeOrganization?: PosLocalEntryOrganization;
  activeStore?: PosLocalEntryStore;
  routeParams?: PosLocalEntryRouteParams;
}) {
  const [seedRead, setSeedRead] = useState<SeedReadState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;

    if (typeof indexedDB === "undefined") {
      setSeedRead({ ok: true, value: null });
      return;
    }

    void (async () => {
      const result = await createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }).readProvisionedTerminalSeed();

      if (!cancelled) {
        setSeedRead(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrganizationSlug = input.activeOrganization?.slug;
  const activeStoreId = input.activeStore?._id;
  const activeStoreSlug = input.activeStore?.slug;
  const routeOrgUrlSlug = input.routeParams?.orgUrlSlug;
  const routeStoreUrlSlug = input.routeParams?.storeUrlSlug;

  return useMemo(
    () =>
      resolveLocalPosEntryContext({
        activeOrganization: activeOrganizationSlug
          ? { slug: activeOrganizationSlug }
          : null,
        activeStore:
          activeStoreId || activeStoreSlug
            ? { _id: activeStoreId, slug: activeStoreSlug }
            : null,
        routeParams: {
          orgUrlSlug: routeOrgUrlSlug,
          storeUrlSlug: routeStoreUrlSlug,
        },
        seedRead,
      }),
    [
      activeOrganizationSlug,
      activeStoreId,
      activeStoreSlug,
      routeOrgUrlSlug,
      routeStoreUrlSlug,
      seedRead,
    ],
  );
}
