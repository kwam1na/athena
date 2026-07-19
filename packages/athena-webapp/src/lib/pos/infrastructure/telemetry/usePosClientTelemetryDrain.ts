import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { setPosErrorTelemetrySink } from "@/lib/pos/application/errorTelemetry";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import {
  enqueuePosClientEvent,
  peekPosClientEventBatch,
  removePosClientEvents,
} from "./telemetryBuffer";

const DRAIN_INTERVAL_MS = 30_000;
const DRAIN_BATCH_SIZE = 50;
const FAILURE_BACKOFF_MS = 120_000;

/**
 * Drains the durable POS telemetry buffer to Convex while a POS surface is
 * mounted. Also owns the runtime capture rails that only make sense while the
 * POS is active: the application-layer unexpected-error sink and
 * window error / unhandledrejection listeners.
 */
export function usePosClientTelemetryDrain(input: {
  storeId: Id<"store"> | undefined;
  terminalId?: Id<"posTerminal">;
}): void {
  const recordClientEvents = useMutation(api.pos.public.telemetry.recordClientEvents);
  const backoffUntilRef = useRef(0);
  const drainInFlightRef = useRef(false);
  const storeIdRef = useRef(input.storeId);
  const terminalIdRef = useRef(input.terminalId);
  storeIdRef.current = input.storeId;
  terminalIdRef.current = input.terminalId;

  const drain = useCallback(async () => {
    const storeId = storeIdRef.current;
    if (!storeId || drainInFlightRef.current) {
      return;
    }
    if (Date.now() < backoffUntilRef.current) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }
    const events = peekPosClientEventBatch(DRAIN_BATCH_SIZE);
    if (events.length === 0) {
      return;
    }
    drainInFlightRef.current = true;
    try {
      const result = await recordClientEvents({
        storeId,
        terminalId: terminalIdRef.current,
        terminalFingerprint: readStoredTerminalFingerprintHash() ?? undefined,
        events: events.map((event) => ({
          clientEventId: event.clientEventId,
          level: event.level,
          flow: event.flow,
          message: event.message,
          occurredAt: event.occurredAt,
          localRegisterSessionId: event.localRegisterSessionId,
          errorName: event.errorName,
          errorMessage: event.errorMessage,
          errorStack: event.errorStack,
          appVersion: event.appVersion,
          metadata: event.metadata,
        })),
      });
      if (result.kind === "ok") {
        removePosClientEvents(events.map((event) => event.clientEventId));
        backoffUntilRef.current = 0;
      } else {
        // Authorization or validation failures will not heal on retry-now;
        // back off so a broken drain never becomes a mutation flood.
        backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      }
    } catch {
      backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
    } finally {
      drainInFlightRef.current = false;
    }
  }, [recordClientEvents]);

  useEffect(() => {
    setPosErrorTelemetrySink((report) => {
      enqueuePosClientEvent({
        level: "error",
        flow: "checkout",
        message: report.message,
        error: report.error,
        metadata: report.operation ? { operation: report.operation } : undefined,
      });
    });
    return () => {
      setPosErrorTelemetrySink(null);
    };
  }, []);

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      enqueuePosClientEvent({
        level: "error",
        flow: "unhandled",
        message: event.message || "Unhandled window error",
        error: event.error,
        metadata: {
          source: event.filename || "unknown",
          line: event.lineno ?? 0,
        },
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      enqueuePosClientEvent({
        level: "error",
        flow: "unhandled",
        message: "Unhandled promise rejection",
        error: event.reason,
      });
    };
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void drain();
    }, DRAIN_INTERVAL_MS);
    const handleOnline = () => {
      void drain();
    };
    window.addEventListener("online", handleOnline);
    void drain();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, [drain]);
}
