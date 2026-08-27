import { readStoredTerminalFingerprintHash } from "../terminal/fingerprint";
import {
  enqueuePosClientEvent,
  posClientTelemetryBufferSize,
} from "./telemetryBuffer";

const M_SUPPLIES_FINGERPRINT =
  "7ddc5c81818e7b3734272bd4bc93b73df2ad228222fa8c27436db01bdb0021ac";
const PRINT_REJECTION_MESSAGE =
  "Failed to execute 'print' on 'Window': The provided callback is no longer runnable.";
const CORRELATION_WINDOW_MS = 60_000;
const OBSERVATION_EXPIRY_MS = 65_000;
const MAX_RECORDED_EVENTS = 16;
// Keep 50 of the shared 200 slots available for errors while a terminal is
// offline. The in-memory candidate remains available for rejection correlation.
const MAX_BUFFERED_EVENTS_BEFORE_BASELINE_SKIP = 150;

type PrintInvocationSource = "load" | "1s-fallback" | "current-window";
type PrintAttemptEvent =
  | "beforeprint"
  | "afterprint"
  | "beforeunload"
  | "unload"
  | "cleanup"
  | "window_closed";
type PrintCompletionReason =
  | "afterprint"
  | "unload"
  | "fallback_cleanup"
  | "popup_blocked_fallback"
  | "sync_throw"
  | "preparation_throw"
  | "window_closed"
  | "superseded"
  | "observation_expired";

type Attempt = {
  id: string;
  startedAt: number;
  invokedAt?: number;
  invocationSource?: PrintInvocationSource;
  readyState?: string;
  invoked: boolean;
  returned: boolean;
  returnType: string;
  returnThenable: "not_checked" | "no" | "not_inspected";
  events: string[];
  windowClosed: boolean;
  expiryTimer: ReturnType<typeof setTimeout>;
};

type AttemptSnapshot = {
  attempt: Attempt;
  expiresAt: number;
  completionReason: PrintCompletionReason;
};

let activeAttempt: Attempt | undefined;
let recentCandidate: AttemptSnapshot | undefined;
let ambiguousUntil = 0;

function isTargetTerminal(): boolean {
  try {
    return readStoredTerminalFingerprintHash() === M_SUPPLIES_FINGERPRINT;
  } catch {
    return false;
  }
}

function mintAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the local id. Diagnostics must never affect printing.
  }
  return `print-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function appendEvent(attempt: Attempt, event: string): void {
  if (attempt.events.length >= MAX_RECORDED_EVENTS) {
    return;
  }
  attempt.events.push(`${event}:${Math.max(0, Date.now() - attempt.startedAt)}`);
}

function buildMetadata(
  attempt: Attempt,
  completionReason: PrintCompletionReason | "active",
): Record<string, string | number | boolean> {
  return {
    printDiagnosticVersion: 1,
    printAttemptId: attempt.id,
    printInvocationSource: attempt.invocationSource ?? "not_invoked",
    printReadyState: attempt.readyState ?? "unknown",
    printInvoked: attempt.invoked,
    printReturned: attempt.returned,
    printReturnType: attempt.returnType,
    printReturnThenable: attempt.returnThenable,
    printEvents: attempt.events.join(",").slice(0, 300),
    printWindowClosed: attempt.windowClosed,
    printCompletionReason: completionReason,
    printElapsedMs: Math.max(0, Date.now() - attempt.startedAt),
  };
}

function getReasonMessage(reason: unknown): string | undefined {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : undefined;
}

export function beginPrintAttempt(): string | undefined {
  try {
    if (!isTargetTerminal()) {
      return undefined;
    }

    if (activeAttempt) {
      finalizePrintAttempt(activeAttempt.id, "superseded", activeAttempt.windowClosed);
    }
    const now = Date.now();
    if (recentCandidate && recentCandidate.expiresAt >= now) {
      ambiguousUntil = Math.max(ambiguousUntil, recentCandidate.expiresAt);
    }

    const id = mintAttemptId();
    const attempt = {
      id,
      startedAt: now,
      invoked: false,
      returned: false,
      returnType: "not_invoked",
      returnThenable: "not_checked" as const,
      events: [],
      windowClosed: false,
      expiryTimer: setTimeout(() => {
        finalizePrintAttempt(id, "observation_expired", attempt.windowClosed);
      }, OBSERVATION_EXPIRY_MS),
    };
    appendEvent(attempt, "start");
    activeAttempt = attempt;
    return id;
  } catch {
    return undefined;
  }
}

export function recordPrintInvocation(
  attemptId: string | undefined,
  input: {
    source: PrintInvocationSource;
    readyState: string;
    windowClosed: boolean;
  },
): void {
  try {
    if (!attemptId || activeAttempt?.id !== attemptId) {
      return;
    }
    activeAttempt.invoked = true;
    activeAttempt.invokedAt = Date.now();
    activeAttempt.invocationSource = input.source;
    activeAttempt.readyState = input.readyState;
    activeAttempt.windowClosed = input.windowClosed;
    appendEvent(activeAttempt, `invoke-${input.source}`);
  } catch {
    // Never let diagnostics alter printing.
  }
}

export function recordPrintReturn(
  attemptId: string | undefined,
  returnValue: unknown,
): void {
  try {
    if (!attemptId || activeAttempt?.id !== attemptId) {
      return;
    }
    activeAttempt.returned = true;
    activeAttempt.returnType = returnValue === null ? "null" : typeof returnValue;
    activeAttempt.returnThenable =
      returnValue !== null &&
      (typeof returnValue === "object" || typeof returnValue === "function")
        ? "not_inspected"
        : "no";
    appendEvent(activeAttempt, "return");
  } catch {
    // Never let diagnostics alter printing.
  }
}

export function recordPrintAttemptEvent(
  attemptId: string | undefined,
  event: PrintAttemptEvent,
  windowClosed: boolean,
): void {
  try {
    if (!attemptId || activeAttempt?.id !== attemptId) {
      return;
    }
    activeAttempt.windowClosed = windowClosed;
    appendEvent(activeAttempt, event);
  } catch {
    // Never let diagnostics alter printing.
  }
}

export function finalizePrintAttempt(
  attemptId: string | undefined,
  completionReason: PrintCompletionReason,
  windowClosed: boolean,
): void {
  try {
    if (!attemptId || activeAttempt?.id !== attemptId) {
      return;
    }
    const attempt = activeAttempt;
    activeAttempt = undefined;
    clearTimeout(attempt.expiryTimer);
    attempt.windowClosed = windowClosed;
    appendEvent(attempt, `finish-${completionReason}`);

    if (
      posClientTelemetryBufferSize() <
      MAX_BUFFERED_EVENTS_BEFORE_BASELINE_SKIP
    ) {
      enqueuePosClientEvent({
        level: "warn",
        flow: "printing",
        classification: "continuity_warning",
        operation: "recordReceiptPrint",
        metadata: {
          printAttemptId: attempt.id,
          printCorrelation: completionReason,
        },
      });
    }

    if (attempt.invoked) {
      recentCandidate = {
        attempt,
        expiresAt: (attempt.invokedAt ?? attempt.startedAt) + CORRELATION_WINDOW_MS,
        completionReason,
      };
    }
  } catch {
    // Never let diagnostics alter printing.
  }
}

export function getPrintRejectionMetadata(
  reason: unknown,
): Record<string, string | number | boolean> | undefined {
  try {
    if (
      !isTargetTerminal() ||
      getReasonMessage(reason) !== PRINT_REJECTION_MESSAGE
    ) {
      return undefined;
    }

    const now = Date.now();
    if (ambiguousUntil >= now) {
      return { printCorrelation: "ambiguous" };
    }

    if (
      activeAttempt?.invoked &&
      (activeAttempt.invokedAt ?? activeAttempt.startedAt) +
        CORRELATION_WINDOW_MS >=
        now
    ) {
      return {
        printCorrelation: "matched",
        ...buildMetadata(activeAttempt, "active"),
      };
    }

    if (recentCandidate && recentCandidate.expiresAt >= now) {
      return {
        printCorrelation: "matched",
        ...buildMetadata(
          recentCandidate.attempt,
          recentCandidate.completionReason,
        ),
      };
    }

    return { printCorrelation: "no_candidate" };
  } catch {
    return { printCorrelation: "correlation_error" };
  }
}

export function resetPrintAttemptTelemetryForTests(): void {
  if (activeAttempt) {
    clearTimeout(activeAttempt.expiryTimer);
  }
  activeAttempt = undefined;
  recentCandidate = undefined;
  ambiguousUntil = 0;
}
