import { useLocation, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect } from "react";
import {
  SharedDemoStatusBar,
  type SharedDemoRestoreStatus,
} from "./SharedDemoStatusBar";
import { getSharedDemoArea, getSharedDemoRoutes } from "./sharedDemoRoutes";
import { api } from "~/convex/_generated/api";
import { generateBrowserFingerprint } from "@/lib/browserFingerprint";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import { readStoredTerminalFingerprint } from "@/lib/pos/infrastructure/terminal/fingerprint";
import { buildPosLocalSyncUploadEvents } from "@/lib/pos/infrastructure/local/syncContract";
import { registerAndProvisionPosTerminal } from "@/lib/pos/application/registerAndProvisionPosTerminal";
import {
  getDefaultPosLocalStore,
  requestDefaultPosLocalPersistentStorage,
} from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import type { Id } from "~/convex/_generated/dataModel";

export function SharedDemoRuntime() {
  const context = useQuery(api.sharedDemo.public.getContext, {});
  const requestRestore = useMutation(
    api.sharedDemo.public.requestManualRestore,
  );
  const registerTerminal = useMutation(
    api.inventory.posTerminal.registerTerminal,
  );
  const ingestDemoPosEvents = useMutation(
    api.pos.public.sync.ingestLocalEvents,
  );
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const location = useLocation();
  useEffect(() => {
    if (!context || !orgUrlSlug || !storeUrlSlug) return;
    let cancelled = false;

    void (async () => {
      const localStore = getDefaultPosLocalStore();
      const epochStorageKey = `athena:shared-demo:restore-epoch:${context.storeId}`;
      const priorEpoch = window.localStorage.getItem(epochStorageKey);
      const storedSeed = await localStore.readProvisionedTerminalSeed();
      const hasPriorDemoState =
        storedSeed.ok && storedSeed.value?.storeId === context.storeId;
      if (
        (priorEpoch !== null &&
          Number(priorEpoch) !== context.restore.epoch) ||
        (priorEpoch === null && hasPriorDemoState)
      ) {
        const reset = await localStore.resetSharedDemoLocalState?.();
        if (reset && !reset.ok) throw new Error(reset.error.message);
      }

      const fingerprint =
        readStoredTerminalFingerprint() ??
        (await generateBrowserFingerprint());
      if (cancelled) return;
      window.localStorage.setItem(
        FINGERPRINT_STORAGE_KEY,
        JSON.stringify(fingerprint),
      );
      const suffix = fingerprint.fingerprintHash.slice(0, 6).toUpperCase();
      const result = await registerAndProvisionPosTerminal({
        activeStoreId: context.storeId,
        browserInfo: fingerprint.browserInfo,
        displayName: "Shared Demo Register",
        fingerprintHash: fingerprint.fingerprintHash,
        heartbeatEnabled: true,
        loginMode: "pos_only",
        orgUrlSlug,
        registerNumber: `WEB-${suffix}`,
        registerTerminalMutation: registerTerminal,
        requestPersistentStorage: requestDefaultPosLocalPersistentStorage,
        storeFactory: getDefaultPosLocalStore,
        storeUrlSlug,
        transactionCapability: "products_only",
      });
      if (result.kind === "user_error") {
        throw new Error(result.error.message);
      }
      window.localStorage.setItem(
        epochStorageKey,
        String(context.restore.epoch),
      );
    })().catch((error) => {
      console.error("[shared-demo] POS bootstrap failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [context, orgUrlSlug, registerTerminal, storeUrlSlug]);
  useEffect(() => {
    if (!context?.storeId) return;
    let cancelled = false;
    let draining = false;

    const drain = async () => {
      if (cancelled || draining) return;
      draining = true;
      try {
        const store = getDefaultPosLocalStore();
        const [seedResult, eventsResult] = await Promise.all([
          store.readProvisionedTerminalSeed(),
          store.listEvents(),
        ]);
        if (
          !seedResult.ok ||
          !eventsResult.ok ||
          !seedResult.value ||
          seedResult.value.storeId !== context.storeId
        ) {
          return;
        }
        const seed = seedResult.value;
        const pending = eventsResult.value.filter(
          (event) =>
            event.storeId === context.storeId &&
            (event.terminalId === seed.terminalId ||
              event.terminalId === seed.cloudTerminalId) &&
            (event.sync.status === "pending" ||
              event.sync.status === "failed"),
        );
        const events = buildPosLocalSyncUploadEvents(
          pending,
          eventsResult.value,
          { appSessionValidation: "supported" },
        );
        if (events.length === 0) return;
        const result = await ingestDemoPosEvents({
          events,
          storeId: context.storeId,
          syncSecretHash: seed.syncSecretHash,
          terminalId: seed.cloudTerminalId as Id<"posTerminal">,
        });
        if (cancelled || result.kind !== "ok") return;
        const projectedIds = result.data.accepted
          .filter((event) => event.status === "projected")
          .map((event) => event.localEventId);
        if (projectedIds.length > 0) {
          await store.markEventsSynced(projectedIds, { uploaded: true });
        }
        const reviewIds = result.data.accepted
          .filter(
            (event) =>
              event.status === "conflicted" || event.status === "rejected",
          )
          .map((event) => event.localEventId);
        if (reviewIds.length > 0) {
          await store.markEventsNeedsReview(
            reviewIds,
            "Cloud sync needs review before this local event can finish.",
            { uploaded: true },
          );
        }
      } catch (error) {
        console.warn("[shared-demo] POS sync retry deferred", error);
      } finally {
        draining = false;
      }
    };

    void drain();
    const interval = window.setInterval(() => void drain(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [context?.storeId, ingestDemoPosEvents]);
  const restore = useCallback(async () => {
    const result = await requestRestore({
      idempotencyKey: crypto.randomUUID(),
    });
    if (result.kind === "rate_limited") throw new Error(result.kind);
  }, [requestRestore]);
  if (!context || !orgUrlSlug || !storeUrlSlug) return null;
  const routes = getSharedDemoRoutes(orgUrlSlug, storeUrlSlug);
  return (
    <SharedDemoStatusBar
      area={getSharedDemoArea(location.pathname)}
      homeHref={routes.home}
      onRestore={restore}
      restoreStatus={context.restore.status as SharedDemoRestoreStatus}
    />
  );
}
