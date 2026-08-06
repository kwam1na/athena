import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "~/convex/_generated/api";
import { setSharedDemoDenialObserver } from "@/lib/errors/sharedDemoDenialObserver";
import {
  buildSharedDemoDenialObservation,
  buildSharedDemoRestoreObservation,
  buildSharedDemoSessionStart,
  buildSharedDemoSurfaceObservation,
  createSharedDemoObservationLedger,
  getOrCreateSharedDemoVisitorSession,
  getSharedDemoViewportBucket,
  hasSharedDemoVisitorSession,
  type SharedDemoObservation,
} from "./sharedDemoActivityTracking";

function currentSessionId() {
  return getOrCreateSharedDemoVisitorSession(window.sessionStorage, () =>
    crypto.randomUUID(),
  );
}

function currentViewportBucket() {
  return getSharedDemoViewportBucket(window.innerWidth);
}

/**
 * Reports what a demo visitor does onto the context event rail. Every write is
 * best-effort: a dropped observation must never be visible to the visitor.
 */
export function useSharedDemoActivityTracking(input: {
  baselineVersion?: number;
  isDemoVisitor: boolean;
  pathname: string;
  restoreEpoch?: number;
  restoreStatus?: "ready" | "restoring" | "failed";
}) {
  const recordActivity = useMutation(
    api.contextTracking.sharedDemoEvents.recordSharedDemoActivity,
  );
  const ledger = useRef(createSharedDemoObservationLedger());
  const denialCount = useRef(0);
  const pathnameRef = useRef(input.pathname);
  const reportRef = useRef<(observation: SharedDemoObservation | null) => void>(
    () => {},
  );

  pathnameRef.current = input.pathname;
  reportRef.current = (observation) => {
    if (!observation || !ledger.current.shouldReport(observation)) return;
    void recordActivity(observation).catch(() => undefined);
  };

  const {
    baselineVersion,
    isDemoVisitor,
    pathname,
    restoreEpoch,
    restoreStatus,
  } = input;

  useEffect(() => {
    if (
      !isDemoVisitor ||
      baselineVersion === undefined ||
      restoreEpoch === undefined
    ) {
      return;
    }

    // Read before minting: an existing session id means the visitor reloaded
    // or navigated back into the demo rather than arriving fresh.
    const isNewSession = !hasSharedDemoVisitorSession(window.sessionStorage);

    reportRef.current(
      buildSharedDemoSessionStart({
        baselineVersion,
        isNewSession,
        occurredAt: Date.now(),
        restoreEpoch,
        sessionId: currentSessionId(),
        viewportBucket: currentViewportBucket(),
      }),
    );
  }, [baselineVersion, isDemoVisitor, restoreEpoch]);

  useEffect(() => {
    if (!isDemoVisitor) return;

    reportRef.current(
      buildSharedDemoSurfaceObservation({
        occurredAt: Date.now(),
        pathname,
        sessionId: currentSessionId(),
        viewportBucket: currentViewportBucket(),
      }),
    );
  }, [isDemoVisitor, pathname]);

  useEffect(() => {
    if (
      !isDemoVisitor ||
      restoreStatus === undefined ||
      restoreEpoch === undefined
    ) {
      return;
    }

    reportRef.current(
      buildSharedDemoRestoreObservation({
        epoch: restoreEpoch,
        occurredAt: Date.now(),
        phase: restoreStatus,
        sessionId: currentSessionId(),
        viewportBucket: currentViewportBucket(),
      }),
    );
  }, [isDemoVisitor, restoreEpoch, restoreStatus]);

  useEffect(() => {
    if (!isDemoVisitor) return;

    return setSharedDemoDenialObserver(() => {
      denialCount.current += 1;
      reportRef.current(
        buildSharedDemoDenialObservation({
          denialSequence: denialCount.current,
          occurredAt: Date.now(),
          // The denial arrives from a command, not from a render, so the
          // surface it belongs to is wherever the visitor is right now.
          pathname: pathnameRef.current,
          sessionId: currentSessionId(),
          viewportBucket: currentViewportBucket(),
        }),
      );
    });
  }, [isDemoVisitor]);
}
