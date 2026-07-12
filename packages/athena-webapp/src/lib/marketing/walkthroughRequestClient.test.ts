import { describe, expect, it, vi } from "vitest";

import {
  WalkthroughSubmissionIdentity,
  canonicalizeWalkthroughPayload,
  resolveWalkthroughRequestUrl,
  submitWalkthroughRequest,
} from "./walkthroughRequestClient";

const payload = {
  name: "  Ama   Mensah ",
  workEmail: " AMA@Example.com ",
  businessName: "  Market   House ",
  phone: " +233 20 000 0000 ",
  businessNeed: " See   sales and inventory together. ",
};

describe("walkthrough request client", () => {
  it("locks the request URL to the mounted Convex HTTP route", () => {
    expect(resolveWalkthroughRequestUrl("https://athena.convex.site/"))
      .toBe("https://athena.convex.site/marketing/walkthrough-requests");
  });

  it("canonicalizes fields with the server contract", () => {
    expect(canonicalizeWalkthroughPayload(payload)).toBe(JSON.stringify({
      name: "Ama Mensah",
      workEmail: "ama@example.com",
      businessName: "Market House",
      phone: "+233 20 000 0000",
      businessNeed: "See sales and inventory together.",
    }));
  });

  it("normalizes control characters before client validation or submission", () => {
    expect(
      canonicalizeWalkthroughPayload({
        ...payload,
        name: "\u0000A",
        businessNeed: "Sales\u0007 and inventory visibility.",
      }),
    ).toContain('"name":"A"');
  });

  it("reuses an identity for unchanged retries and rotates after an attempted edit", () => {
    const keys = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
    const identity = new WalkthroughSubmissionIdentity(() => keys.shift()!);

    expect(identity.beginAttempt(payload)).toBe("a".repeat(32));
    expect(identity.beginAttempt({ ...payload })).toBe("a".repeat(32));

    identity.notePayloadChange({ ...payload, businessNeed: "A changed need." });
    expect(identity.beginAttempt({ ...payload, businessNeed: "A changed need." }))
      .toBe("b".repeat(32));
  });

  it("posts only JSON to the owned ingress and accepts durable success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: true }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));

    await expect(submitWalkthroughRequest(
      { ...payload, submissionKey: "a".repeat(32), website: "" },
      { apiGatewayUrl: "https://athena.convex.site", fetchImpl },
    )).resolves.toEqual({ kind: "accepted" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://athena.convex.site/marketing/walkthrough-requests",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("collapses network and malformed responses to a recoverable result", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("private detail"));
    await expect(submitWalkthroughRequest(
      { ...payload, submissionKey: "a".repeat(32), website: "" },
      { apiGatewayUrl: "https://athena.convex.site", fetchImpl },
    )).resolves.toEqual({ kind: "temporarily_unavailable" });
  });

  it("does not start a request when the caller signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      submitWalkthroughRequest(
        { ...payload, submissionKey: "a".repeat(32), website: "" },
        {
          apiGatewayUrl: "https://athena.convex.site",
          fetchImpl,
          signal: controller.signal,
        },
      ),
    ).resolves.toEqual({ kind: "temporarily_unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps timeout protection active while the response body is read", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            }),
        }) as Response,
    );

    await expect(
      submitWalkthroughRequest(
        { ...payload, submissionKey: "a".repeat(32), website: "" },
        {
          apiGatewayUrl: "https://athena.convex.site",
          fetchImpl,
          timeoutMs: 1,
        },
      ),
    ).resolves.toEqual({ kind: "temporarily_unavailable" });
  });
});
