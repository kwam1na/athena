import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import {
  beginPosTerminalIdentityTransition,
  capturePosTelemetryOccurrenceContext,
  getPosTelemetryDocumentBootstrapGeneration,
  isPosTerminalIdentityTransitionStale,
  isPosTerminalIdentityUncoordinatedQuiescent,
  POS_TERMINAL_IDENTITY_CHANGE_EVENT,
  POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY,
  POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT,
  readPosTerminalIdentityTransition,
  registerPosTelemetryContext,
  settlePosTerminalIdentityTransition,
  stabilizePosTerminalIdentityUncoordinated,
  type PosTerminalIdentityTransition,
  withPosTerminalIdentityWriteLock,
} from "@/lib/pos/infrastructure/telemetry/telemetryContext";
import { usePosClientTelemetryDrain } from "@/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain";
import {
  incrementPosRuntimeCounter,
  setPosRuntimeCounter,
} from "@/lib/pos/infrastructure/telemetry/runtimeCounters";

const TELEMETRY_CONTEXT_REFRESH_MS = 5_000;

function mintTelemetryContextToken() {
  return `pos-context-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Invisible host that keeps the POS telemetry drain (and its error-capture
 * rails) alive while a POS surface is mounted.
 */
export function PosClientTelemetryHost() {
  const { activeStore } = useGetActiveStore();
  const ownerTokenRef = useRef(getPosTelemetryDocumentBootstrapGeneration());
  const route = capturePosTelemetryOccurrenceContext();
  const routeOrgUrlSlug = route?.orgUrlSlug;
  const routeStoreUrlSlug = route?.storeUrlSlug;
  const identityScopeKey =
    activeStore?._id && routeOrgUrlSlug && routeStoreUrlSlug
      ? `${routeOrgUrlSlug}|${routeStoreUrlSlug}|${activeStore._id}`
      : undefined;
  const [resolvedIdentityScopeKey, setResolvedIdentityScopeKey] = useState<
    string | undefined
  >();

  useEffect(() => {
    let cancelled = false;
    let unregister: (() => void) | undefined;
    let refreshSequence = 0;
    let refreshInFlight = false;
    let refreshQueued = false;
    let refreshQueuedForceSharedRead = false;
    let registeredSignature: string | undefined;
    let registeredIdentityGeneration =
      readPosTerminalIdentityTransition().generation;
    let hasResolvedIdentity = false;
    if (!activeStore?._id || !routeOrgUrlSlug || !routeStoreUrlSlug) return;

    const routeContext = {
      orgUrlSlug: routeOrgUrlSlug,
      storeUrlSlug: routeStoreUrlSlug,
      storeId: activeStore._id,
    };
    const initialFingerprint = readStoredTerminalFingerprintHash();
    const baseContext = {
      ...routeContext,
      ...(initialFingerprint
        ? { reportedTerminalFingerprint: initialFingerprint }
        : {}),
    };
    unregister = registerPosTelemetryContext(
      ownerTokenRef.current,
      baseContext,
    );
    registeredSignature = JSON.stringify(baseContext);

    const fenceToGeneration = (generation: string) => {
      unregister?.();
      ownerTokenRef.current = generation;
      unregister = registerPosTelemetryContext(
        ownerTokenRef.current,
        routeContext,
      );
      registeredSignature = JSON.stringify(routeContext);
      registeredIdentityGeneration = generation;
      hasResolvedIdentity = false;
      flushSync(() => setResolvedIdentityScopeKey(undefined));
    };

    const refreshContext = async (forceSharedRead = false) => {
      if (refreshInFlight) {
        refreshQueued = true;
        refreshQueuedForceSharedRead ||= forceSharedRead;
        return;
      }
      refreshInFlight = true;
      const sequence = ++refreshSequence;
      let releaseDrain = false;
      let recoveringIdentityTransition = false;
      try {
        let transition = readPosTerminalIdentityTransition({
          forceSharedRead,
        });
        const generationChanged =
          transition.generation !== registeredIdentityGeneration;
        if (generationChanged) fenceToGeneration(transition.generation);
        if (transition.phase === "changing") {
          if (!isPosTerminalIdentityTransitionStale(transition)) return;
          recoveringIdentityTransition = true;
        } else if (transition.phase === "uncoordinated") {
          recoveringIdentityTransition = true;
        }

        let seedResult;
        if (recoveringIdentityTransition) {
          const recovery = await withPosTerminalIdentityWriteLock(async () => {
            let lockedTransition = readPosTerminalIdentityTransition({
              forceSharedRead: true,
            });
            if (
              lockedTransition.phase === "changing" &&
              !isPosTerminalIdentityTransitionStale(lockedTransition)
            ) {
              return undefined;
            }
            const lockedSeedResult =
              await getDefaultPosLocalStore().readProvisionedTerminalSeed({
                reportFailure: false,
              });
            if (lockedSeedResult.ok) {
              if (lockedTransition.phase === "uncoordinated") {
                const coordinatedLease = beginPosTerminalIdentityTransition();
                if (!coordinatedLease) return undefined;
                lockedTransition = coordinatedLease;
              }
              if (lockedTransition.phase === "changing") {
                lockedTransition =
                  settlePosTerminalIdentityTransition(lockedTransition);
              }
            }
            return {
              seedResult: lockedSeedResult,
              transition: lockedTransition,
            };
          });
          if (recovery.acquired && recovery.value) {
            seedResult = recovery.value.seedResult;
            transition = recovery.value.transition;
          } else {
            const latest = readPosTerminalIdentityTransition({
              forceSharedRead: true,
            });
            if (!isPosTerminalIdentityUncoordinatedQuiescent(latest)) return;
            seedResult =
              await getDefaultPosLocalStore().readProvisionedTerminalSeed({
                reportFailure: false,
              });
            if (!seedResult.ok) return;
            const stabilized = stabilizePosTerminalIdentityUncoordinated(
              readPosTerminalIdentityTransition({ forceSharedRead: true }),
            );
            if (!stabilized) return;
            transition = stabilized;
          }
        } else {
          seedResult =
            await getDefaultPosLocalStore().readProvisionedTerminalSeed({
              reportFailure: false,
            });
        }
        if (cancelled || sequence !== refreshSequence) return;
        if (!seedResult.ok) {
          incrementPosRuntimeCounter("telemetry.identityRefreshFailureCount");
          setPosRuntimeCounter(
            "telemetry.lastIdentityRefreshFailureAt",
            Date.now(),
          );
          releaseDrain = !recoveringIdentityTransition;
          return;
        }
        if (recoveringIdentityTransition) {
          if (transition.generation !== registeredIdentityGeneration) {
            fenceToGeneration(transition.generation);
          }
          if (transition.phase !== "changed") return;
        }
        const seed = seedResult.value;
        const fingerprint = readStoredTerminalFingerprintHash();
        const context = {
          ...routeContext,
          ...(seed?.telemetryIdentityEpoch
            ? { telemetryIdentityEpoch: seed.telemetryIdentityEpoch }
            : {}),
          ...(seed?.storeId === activeStore._id && seed.cloudTerminalId
            ? { reportedCloudTerminalId: seed.cloudTerminalId }
            : {}),
          ...(fingerprint
            ? {
                reportedTerminalFingerprint: fingerprint,
              }
            : {}),
        };
        const signature = JSON.stringify(context);
        const identityGeneration = transition.generation;
        if (
          signature === registeredSignature &&
          identityGeneration === registeredIdentityGeneration
        ) {
          hasResolvedIdentity = true;
          releaseDrain = true;
          return;
        }
        if (hasResolvedIdentity) {
          fenceToGeneration(identityGeneration);
          ownerTokenRef.current = mintTelemetryContextToken();
        }
        unregister?.();
        unregister = registerPosTelemetryContext(
          ownerTokenRef.current,
          context,
        );
        registeredSignature = signature;
        registeredIdentityGeneration = identityGeneration;
        hasResolvedIdentity = true;
        releaseDrain = true;
      } catch {
        incrementPosRuntimeCounter("telemetry.identityRefreshFailureCount");
        setPosRuntimeCounter(
          "telemetry.lastIdentityRefreshFailureAt",
          Date.now(),
        );
        releaseDrain = !recoveringIdentityTransition;
      } finally {
        refreshInFlight = false;
        if (
          releaseDrain &&
          !cancelled &&
          identityScopeKey &&
          sequence === refreshSequence
        ) {
          setResolvedIdentityScopeKey(identityScopeKey);
        }
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          const forceQueuedSharedRead = refreshQueuedForceSharedRead;
          refreshQueuedForceSharedRead = false;
          void refreshContext(forceQueuedSharedRead);
        }
      }
    };

    const handlePossibleIdentityChange = () => void refreshContext(true);
    const handleFingerprintStorageChange = (event: StorageEvent) => {
      if (
        event.key === FINGERPRINT_STORAGE_KEY ||
        event.key === POS_TERMINAL_IDENTITY_GENERATION_STORAGE_KEY
      )
        void refreshContext(true);
    };
    const handleTerminalIdentityChange = (event: Event) => {
      const transition = (
        event as CustomEvent<Partial<PosTerminalIdentityTransition>>
      ).detail;
      if (
        (transition?.phase === "changing" ||
          transition?.phase === "uncoordinated") &&
        typeof transition.generation === "string"
      ) {
        refreshSequence += 1;
        fenceToGeneration(transition.generation);
        if (transition.phase === "uncoordinated") void refreshContext(true);
        return;
      }
      if (transition?.phase === "changed") void refreshContext(true);
    };
    const interval = window.setInterval(
      handlePossibleIdentityChange,
      TELEMETRY_CONTEXT_REFRESH_MS,
    );
    window.addEventListener("focus", handlePossibleIdentityChange);
    window.addEventListener("storage", handleFingerprintStorageChange);
    window.addEventListener(
      POS_TERMINAL_IDENTITY_CHANGE_EVENT,
      handleTerminalIdentityChange,
    );
    window.addEventListener(
      POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT,
      handlePossibleIdentityChange,
    );
    void refreshContext(true);

    return () => {
      cancelled = true;
      refreshSequence += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", handlePossibleIdentityChange);
      window.removeEventListener("storage", handleFingerprintStorageChange);
      window.removeEventListener(
        POS_TERMINAL_IDENTITY_CHANGE_EVENT,
        handleTerminalIdentityChange,
      );
      window.removeEventListener(
        POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT,
        handlePossibleIdentityChange,
      );
      unregister?.();
    };
  }, [activeStore?._id, identityScopeKey, routeOrgUrlSlug, routeStoreUrlSlug]);

  usePosClientTelemetryDrain({
    identityReady:
      identityScopeKey !== undefined &&
      resolvedIdentityScopeKey === identityScopeKey,
  });
  return null;
}
