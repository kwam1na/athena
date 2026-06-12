import { describe, expect, it } from "vitest";

import {
  buildRemoteAssistCoBrowseFrame,
  validateRemoteAssistControlIntent,
} from "./contract";

describe("remote assist live contract", () => {
  it("builds a sanitized co-browse frame without sensitive rectangles", () => {
    expect(
      buildRemoteAssistCoBrowseFrame({
        capturedAt: 1_000,
        frameId: " frame-1 ",
        route: "/wigclub/store/wigclub/pos",
        sensitiveRegions: [
          {
            id: "staff-proof",
            label: "Staff proof",
            rect: { x: 10, y: 20, width: 120, height: 44 },
          },
        ],
        sessionId: "session-1",
        viewport: { width: 1280, height: 720 },
      }),
    ).toEqual({
      capturedAt: 1_000,
      frameId: "frame-1",
      redaction: {
        inputValuesMasked: true,
        sensitiveRegionCount: 1,
      },
      route: "/wigclub/store/wigclub/pos",
      sensitiveRegions: [
        {
          id: "staff-proof",
          label: "Staff proof",
        },
      ],
      sessionId: "session-1",
      viewport: { width: 1280, height: 720 },
    });
  });

  it("accepts bounded Athena-surface control intents", () => {
    expect(
      validateRemoteAssistControlIntent({
        intent: {
          event: {
            action: "down",
            pointerId: "primary",
            type: "pointer",
            x: 42,
            y: 56,
          },
          idempotencyKey: "control-1",
          issuedAt: 1_000,
          reason: "Open support panel",
          sessionId: "session-1",
          target: "athena_surface",
        },
        viewport: { width: 320, height: 480 },
      }),
    ).toEqual({
      accepted: true,
      event: {
        action: "down",
        pointerId: "primary",
        type: "pointer",
        x: 42,
        y: 56,
      },
      idempotencyKey: "control-1",
      sessionId: "session-1",
    });
  });

  it("rejects controls targeting sensitive regions", () => {
    expect(
      validateRemoteAssistControlIntent({
        intent: {
          event: {
            action: "up",
            pointerId: "primary",
            type: "pointer",
            x: 42,
            y: 56,
          },
          idempotencyKey: "control-2",
          issuedAt: 1_000,
          reason: "Inspect staff proof",
          sessionId: "session-1",
          target: "athena_surface",
        },
        sensitiveRegions: [
          {
            id: "staff-proof",
            label: "Staff proof",
            rect: { x: 10, y: 20, width: 120, height: 44 },
          },
        ],
        viewport: { width: 320, height: 480 },
      }),
    ).toEqual({
      accepted: false,
      idempotencyKey: "control-2",
      reason: "sensitive_region",
      regionId: "staff-proof",
      sessionId: "session-1",
    });
  });

  it("rejects non-Athena targets before transport", () => {
    expect(
      validateRemoteAssistControlIntent({
        intent: {
          event: {
            action: "down",
            code: "Enter",
            type: "key",
          },
          idempotencyKey: "control-3",
          issuedAt: 1_000,
          reason: "Run shell command",
          sessionId: "session-1",
          target: "devtools" as never,
        },
        viewport: { width: 320, height: 480 },
      }),
    ).toEqual({
      accepted: false,
      idempotencyKey: "control-3",
      reason: "invalid_event",
      sessionId: "session-1",
    });
  });
});
