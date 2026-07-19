import { afterEach, describe, expect, it, vi } from "vitest";

import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";
import { setPosErrorTelemetrySink } from "./errorTelemetry";
import { mapThrownError } from "./results";

describe("mapThrownError", () => {
  afterEach(() => {
    setPosErrorTelemetrySink(null);
  });

  it("flattens unknown errors to the generic message but reports the raw error", () => {
    const sink = vi.fn();
    setPosErrorTelemetrySink(sink);
    const thrown = new Error("ReferenceError: totals is undefined");

    const result = mapThrownError(thrown, "completeTransaction");

    expect(result).toEqual({
      ok: false,
      code: "unknown",
      message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    });
    expect(sink).toHaveBeenCalledWith({
      message: "POS use case threw an unexpected error",
      operation: "completeTransaction",
      error: thrown,
    });
  });

  it("does not report known conflict messages", () => {
    const sink = vi.fn();
    setPosErrorTelemetrySink(sink);

    const result = mapThrownError(
      new Error("A register session is already open for this terminal"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it("never lets a throwing sink break the use case result", () => {
    setPosErrorTelemetrySink(() => {
      throw new Error("sink exploded");
    });

    const result = mapThrownError(new Error("boom"));

    expect(result.ok).toBe(false);
  });

  it("still maps errors when no sink is registered", () => {
    const result = mapThrownError("string failure");
    expect(result).toEqual({
      ok: false,
      code: "unknown",
      message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    });
  });
});
