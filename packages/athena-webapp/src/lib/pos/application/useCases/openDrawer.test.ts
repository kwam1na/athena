import { afterEach, describe, expect, it, vi } from "vitest";

import { setPosErrorTelemetrySink } from "../errorTelemetry";
import { openDrawer } from "./openDrawer";

describe("openDrawer", () => {
  afterEach(() => {
    setPosErrorTelemetrySink(null);
  });

  it("reports an unexpected gateway throw with register context", async () => {
    const sink = vi.fn();
    setPosErrorTelemetrySink(sink);
    const error = new Error("private native detail");

    const result = await openDrawer({
      gateway: { openDrawer: vi.fn().mockRejectedValue(error) },
      command: {
        openingFloat: 100,
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
      },
    });

    expect(result).toMatchObject({ ok: false, code: "unknown" });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "unexpected_application_error",
        error,
        flow: "register",
        operation: "openDrawer",
      }),
    );
  });
});
