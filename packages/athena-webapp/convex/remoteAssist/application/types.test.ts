import { describe, expect, it } from "vitest";

import {
  sanitizeRemoteAssistMetadata,
  summarizeRemoteAssistReason,
} from "./types";

describe("remote assist types", () => {
  it("rejects top-level secret-like audit metadata fields", () => {
    const result = sanitizeRemoteAssistMetadata({
      terminalSyncSecret: "secret",
      reason: "support recovery",
    });

    expect(result).toMatchObject({
      error: {
        code: "validation_failed",
      },
      kind: "user_error",
    });
  });

  it("redacts nested secret-like values and bounds string metadata", () => {
    const result = sanitizeRemoteAssistMetadata({
      adapter: {
        terminalId: "terminal-1",
        paymentPayload: "raw",
      },
      note: ` ${"operator detail ".repeat(40)} `,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.data).toMatchObject({
      adapter: {
        terminalId: "terminal-1",
        paymentPayload: "[redacted]",
      },
    });
    expect(String(result.data?.note)).toHaveLength(240);
  });

  it("normalizes session reasons for audit display", () => {
    expect(summarizeRemoteAssistReason("  M Supplies\nterminal\trecovery  ")).toBe(
      "M Supplies terminal recovery",
    );
  });
});
