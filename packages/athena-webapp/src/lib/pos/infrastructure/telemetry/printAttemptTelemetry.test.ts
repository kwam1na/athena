import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bufferSize: 0,
  enqueue: vi.fn(),
  fingerprint:
    "7ddc5c81818e7b3734272bd4bc93b73df2ad228222fa8c27436db01bdb0021ac" as
      | string
      | null,
}));

vi.mock("../terminal/fingerprint", () => ({
  readStoredTerminalFingerprintHash: () => mocks.fingerprint,
}));

vi.mock("./telemetryBuffer", () => ({
  enqueuePosClientEvent: mocks.enqueue,
  posClientTelemetryBufferSize: () => mocks.bufferSize,
}));

import {
  beginPrintAttempt,
  finalizePrintAttempt,
  getPrintRejectionMetadata,
  recordPrintAttemptEvent,
  recordPrintInvocation,
  recordPrintReturn,
  resetPrintAttemptTelemetryForTests,
} from "./printAttemptTelemetry";

const PRINT_REJECTION = new Error(
  "Failed to execute 'print' on 'Window': The provided callback is no longer runnable.",
);

describe("printAttemptTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T08:00:00.000Z"));
    mocks.enqueue.mockReset();
    mocks.bufferSize = 0;
    mocks.fingerprint =
      "7ddc5c81818e7b3734272bd4bc93b73df2ad228222fa8c27436db01bdb0021ac";
    resetPrintAttemptTelemetryForTests();
  });

  it("emits one compact baseline for a targeted attempt", () => {
    const attemptId = beginPrintAttempt();
    expect(attemptId).toBeTruthy();

    recordPrintInvocation(attemptId, {
      source: "load",
      readyState: "complete",
      windowClosed: false,
    });
    recordPrintAttemptEvent(attemptId, "beforeprint", false);
    recordPrintReturn(attemptId, undefined);
    recordPrintAttemptEvent(attemptId, "afterprint", false);
    for (let index = 0; index < 30; index += 1) {
      vi.advanceTimersByTime(1);
      recordPrintAttemptEvent(attemptId, "cleanup", false);
    }
    finalizePrintAttempt(attemptId, "afterprint", false);

    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        flow: "printing",
        classification: "continuity_warning",
        operation: "recordReceiptPrint",
        metadata: expect.objectContaining({
          printAttemptId: attemptId,
          printCorrelation: "afterprint",
        }),
      }),
    );

    const metadata = mocks.enqueue.mock.calls[0][0].metadata;
    expect(metadata).toEqual({
      printAttemptId: attemptId,
      printCorrelation: "afterprint",
    });
    expect(JSON.stringify(metadata)).not.toContain("receipt");

    const rejectionMetadata = getPrintRejectionMetadata(PRINT_REJECTION);
    expect(Object.keys(rejectionMetadata ?? {}).length).toBeLessThanOrEqual(20);
    expect(String(rejectionMetadata?.printEvents).length).toBeLessThanOrEqual(
      300,
    );
  });

  it("does not emit diagnostics for another terminal", () => {
    mocks.fingerprint = "another-terminal";

    const attemptId = beginPrintAttempt();
    finalizePrintAttempt(attemptId, "sync_throw", false);

    expect(attemptId).toBeUndefined();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toBeUndefined();
  });

  it("does not inspect or subscribe to a possible thenable", () => {
    const then = vi.fn();
    const attemptId = beginPrintAttempt();
    recordPrintInvocation(attemptId, {
      source: "1s-fallback",
      readyState: "loading",
      windowClosed: false,
    });
    recordPrintReturn(attemptId, { then });
    finalizePrintAttempt(attemptId, "fallback_cleanup", false);

    expect(then).not.toHaveBeenCalled();
    expect(mocks.enqueue.mock.calls[0][0].metadata).toMatchObject({
      printAttemptId: attemptId,
      printCorrelation: "fallback_cleanup",
    });
  });

  it("correlates only the exact rejection with one recent attempt", () => {
    const attemptId = beginPrintAttempt();
    recordPrintInvocation(attemptId, {
      source: "load",
      readyState: "complete",
      windowClosed: false,
    });
    recordPrintReturn(attemptId, undefined);

    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toMatchObject({
      printCorrelation: "matched",
      printAttemptId: attemptId,
      printInvocationSource: "load",
    });
    expect(
      getPrintRejectionMetadata(new Error("A different rejection")),
    ).toBeUndefined();
  });

  it("refuses correlation after another attempt starts in the retention window", () => {
    const firstAttemptId = beginPrintAttempt();
    recordPrintInvocation(firstAttemptId, {
      source: "load",
      readyState: "complete",
      windowClosed: false,
    });
    recordPrintReturn(firstAttemptId, undefined);
    finalizePrintAttempt(firstAttemptId, "afterprint", false);

    vi.advanceTimersByTime(1_000);
    const secondAttemptId = beginPrintAttempt();
    recordPrintInvocation(secondAttemptId, {
      source: "1s-fallback",
      readyState: "loading",
      windowClosed: false,
    });

    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toEqual({
      printCorrelation: "ambiguous",
    });
  });

  it("marks exact rejections without a recent candidate", () => {
    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toEqual({
      printCorrelation: "no_candidate",
    });

    const attemptId = beginPrintAttempt();
    recordPrintInvocation(attemptId, {
      source: "load",
      readyState: "complete",
      windowClosed: false,
    });
    recordPrintReturn(attemptId, undefined);
    finalizePrintAttempt(attemptId, "afterprint", false);
    vi.advanceTimersByTime(60_001);

    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toEqual({
      printCorrelation: "no_candidate",
    });
  });

  it("finalizes expired and superseded attempts exactly once", () => {
    const firstAttemptId = beginPrintAttempt();
    const secondAttemptId = beginPrintAttempt();

    expect(firstAttemptId).not.toEqual(secondAttemptId);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.calls[0][0].metadata).toMatchObject({
      printAttemptId: firstAttemptId,
      printCorrelation: "superseded",
    });

    vi.advanceTimersByTime(65_000);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue.mock.calls[1][0].metadata).toMatchObject({
      printAttemptId: secondAttemptId,
      printCorrelation: "observation_expired",
    });
  });

  it("reserves offline buffer capacity for errors", () => {
    mocks.bufferSize = 150;
    const attemptId = beginPrintAttempt();
    recordPrintInvocation(attemptId, {
      source: "load",
      readyState: "complete",
      windowClosed: false,
    });
    recordPrintReturn(attemptId, undefined);
    finalizePrintAttempt(attemptId, "afterprint", false);

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(getPrintRejectionMetadata(PRINT_REJECTION)).toMatchObject({
      printCorrelation: "matched",
      printAttemptId: attemptId,
    });
  });
});
