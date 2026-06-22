import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config", () => ({
  default: {
    apiGateway: {
      URL: "https://athena.example",
    },
  },
}));

import { postTrackingEvent } from "./trackingEvents";

describe("postTrackingEvent", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, appended: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    fetchMock.mockReset();
  });

  it("posts context envelopes through the tracking-events boundary", async () => {
    await expect(
      postTrackingEvent({
        surface: "storefront",
        eventId: "storefront.route_viewed",
        schemaVersion: 1,
        idempotencyKey: "storefront:route",
        occurredAt: 1,
        payload: {
          route: "/shop",
        },
        sessionRef: {
          kind: "storefront_session",
          id: "session_ctx_123",
        },
        visibilityMode: "store_admin",
        retentionClass: "standard",
      }),
    ).resolves.toEqual({ ok: true, appended: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://athena.example/tracking-events",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      surface: "storefront",
      eventId: "storefront.route_viewed",
      payload: {
        route: "/shop",
      },
      sessionRef: {
        kind: "storefront_session",
        id: "session_ctx_123",
      },
    });
  });
});
