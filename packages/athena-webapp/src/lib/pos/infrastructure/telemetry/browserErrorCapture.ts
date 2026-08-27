import type {
  PosDiagnosticClassification,
  PosDiagnosticOperation,
  PosDiagnosticSource,
} from "~/shared/posDiagnosticRedaction";
import { normalizePosDiagnosticSource } from "~/shared/posDiagnosticRedaction";
import { isExpectedPosTelemetryOutcome } from "@/lib/pos/application/expectedTelemetryOutcome";
import { getPrintRejectionMetadata } from "./printAttemptTelemetry";

export type PosBrowserCaptureFixtureState =
  | "resolving"
  | "authored"
  | "live";

export type PosBrowserErrorCaptureReport = {
  classification: PosDiagnosticClassification;
  error?: Error;
  flow: "unhandled";
  operation: PosDiagnosticOperation;
  metadata?: Record<string, unknown>;
  pathname: string;
  source?: PosDiagnosticSource;
};

type CaptureOwner = {
  token: symbol;
  handleError: (event: ErrorEvent) => void;
  handleRejection: (event: PromiseRejectionEvent) => void;
};

let fixtureState: PosBrowserCaptureFixtureState = "resolving";
let activeOwner: CaptureOwner | undefined;
const claimedFailures = new WeakSet<object>();

export function setPosBrowserCaptureFixtureState(
  nextState: PosBrowserCaptureFixtureState,
): void {
  fixtureState = nextState;
}

function isCurrentPosPath(): boolean {
  return /\/store\/[^/]+\/pos(?:\/|$)/.test(window.location.pathname);
}

export function isPosBrowserCaptureEnabledForCurrentLocation(): boolean {
  if (!isCurrentPosPath()) return false;

  const fixtureName = new URLSearchParams(window.location.search).get("fixture");
  return !fixtureName || fixtureState === "live";
}

/** Claims one object-shaped failure across bootstrap and route boundaries. */
export function claimPosTelemetryFailure(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return true;
  }
  if (claimedFailures.has(value)) return false;
  claimedFailures.add(value);
  return true;
}

function asError(value: unknown): Error | undefined {
  return value instanceof Error ? value : undefined;
}

function normalizeWindowSource(event: ErrorEvent): PosDiagnosticSource | undefined {
  if (!event.filename) return undefined;

  try {
    const sourceUrl = new URL(event.filename, window.location.origin);
    if (sourceUrl.origin !== window.location.origin) return undefined;
    return normalizePosDiagnosticSource({
      asset: sourceUrl.pathname,
      column: event.colno,
      line: event.lineno,
    });
  } catch {
    return undefined;
  }
}

export function installPosBrowserErrorCapture(input: {
  capture: (report: PosBrowserErrorCaptureReport) => void;
}): () => void {
  if (activeOwner) {
    window.removeEventListener("error", activeOwner.handleError);
    window.removeEventListener(
      "unhandledrejection",
      activeOwner.handleRejection,
    );
  }

  const token = Symbol("pos-browser-error-capture-owner");
  const handleError = (event: ErrorEvent) => {
    if (!isPosBrowserCaptureEnabledForCurrentLocation()) return;

    const failure = event.error ?? event;
    if (isExpectedPosTelemetryOutcome(failure)) return;
    if (!claimPosTelemetryFailure(failure)) return;

    const source = normalizeWindowSource(event);
    input.capture({
      classification: "unhandled_window_error",
      error: asError(event.error),
      flow: "unhandled",
      operation: "window_runtime",
      pathname: window.location.pathname,
      ...(source ? { source } : {}),
    });
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    if (!isPosBrowserCaptureEnabledForCurrentLocation()) return;
    if (isExpectedPosTelemetryOutcome(event.reason)) return;
    if (!claimPosTelemetryFailure(event.reason)) return;

    const printMetadata = getPrintRejectionMetadata(event.reason);
    input.capture({
      classification: "unhandled_promise_rejection",
      error: asError(event.reason),
      flow: "unhandled",
      operation: "promise_runtime",
      pathname: window.location.pathname,
      ...(printMetadata ? { metadata: printMetadata } : {}),
    });
  };

  activeOwner = { handleError, handleRejection, token };
  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);

  return () => {
    if (activeOwner?.token !== token) return;
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
    activeOwner = undefined;
  };
}
