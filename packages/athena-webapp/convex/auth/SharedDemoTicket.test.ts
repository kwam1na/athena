import { describe, expect, it, vi } from "vitest";

import {
  authorizeSharedDemoTicket,
  SHARED_DEMO_AUTH_PROVIDER_ID,
} from "./SharedDemoTicket";

describe("SharedDemoTicket provider", () => {
  it("uses the stable frontend provider id and returns only the configured auth user", async () => {
    const runMutation = vi.fn().mockResolvedValue({ authUserId: "auth-user" });
    await expect(
      authorizeSharedDemoTicket({ ticket: "opaque-ticket" }, { runMutation } as never),
    ).resolves.toEqual({ userId: "auth-user" });
    expect(SHARED_DEMO_AUTH_PROVIDER_ID).toBe("shared-demo");
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      {},
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      { ticketHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
    );
  });

  it.each([{}, { ticket: "" }, { ticket: "x".repeat(257) }])(
    "rejects malformed credentials without touching storage",
    async (credentials) => {
      const runMutation = vi.fn();
      await expect(
        authorizeSharedDemoTicket(credentials, { runMutation } as never),
      ).resolves.toBeNull();
      expect(runMutation).not.toHaveBeenCalled();
    },
  );

  it("normalizes consumed or expired ticket failures", async () => {
    const runMutation = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("internal detail"));
    await expect(
      authorizeSharedDemoTicket({ ticket: "opaque-ticket" }, { runMutation } as never),
    ).resolves.toBeNull();
    expect(runMutation).toHaveBeenCalledTimes(2);
  });
});
