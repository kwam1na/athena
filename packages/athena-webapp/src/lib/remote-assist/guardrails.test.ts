import { describe, expect, it } from "vitest";

import {
  createSensitiveRegionSet,
  maskTextForRemoteAssist,
  validateRemoteAssistControlEvent,
} from "./guardrails";

describe("remote assist guardrails", () => {
  it("bounds pointer control events to the shared viewport", () => {
    expect(
      validateRemoteAssistControlEvent(
        {
          type: "pointer",
          action: "move",
          pointerId: "primary",
          x: 120,
          y: 240,
        },
        { width: 320, height: 480 },
      ),
    ).toEqual({
      ok: true,
      event: {
        type: "pointer",
        action: "move",
        pointerId: "primary",
        x: 120,
        y: 240,
      },
    });

    expect(
      validateRemoteAssistControlEvent(
        {
          type: "pointer",
          action: "down",
          pointerId: "primary",
          x: 321,
          y: 240,
        },
        { width: 320, height: 480 },
      ),
    ).toEqual({
      ok: false,
      reason: "pointer_out_of_bounds",
    });
  });

  it("allows only bounded, non-text keyboard controls", () => {
    expect(
      validateRemoteAssistControlEvent(
        {
          type: "key",
          action: "down",
          code: "Tab",
        },
        { width: 320, height: 480 },
      ),
    ).toEqual({
      ok: true,
      event: {
        type: "key",
        action: "down",
        code: "Tab",
      },
    });

    expect(
      validateRemoteAssistControlEvent(
        {
          type: "key",
          action: "down",
          code: "KeyA",
        },
        { width: 320, height: 480 },
      ),
    ).toEqual({
      ok: false,
      reason: "key_not_allowed",
    });
  });

  it("blocks control events that target sensitive regions", () => {
    const regions = createSensitiveRegionSet([
      {
        id: "pin-pad",
        label: "Cashier PIN",
        rect: { x: 16, y: 24, width: 120, height: 80 },
      },
    ]);

    expect(
      regions.isPointBlocked({
        x: 42,
        y: 56,
      }),
    ).toBe(true);
    expect(regions.isPointBlocked({ x: 180, y: 56 })).toBe(false);

    expect(
      validateRemoteAssistControlEvent(
        {
          type: "pointer",
          action: "up",
          pointerId: "primary",
          x: 42,
          y: 56,
        },
        { width: 320, height: 480 },
        regions,
      ),
    ).toEqual({
      ok: false,
      reason: "sensitive_region",
      regionId: "pin-pad",
    });
  });

  it("masks sensitive text while preserving surrounding context", () => {
    expect(maskTextForRemoteAssist("PIN 1234 approved")).toBe(
      "PIN [masked] approved",
    );
    expect(maskTextForRemoteAssist("OTP: 981266")).toBe("OTP: [masked]");
    expect(maskTextForRemoteAssist("Cashier Jane")).toBe("Cashier Jane");
  });
});
