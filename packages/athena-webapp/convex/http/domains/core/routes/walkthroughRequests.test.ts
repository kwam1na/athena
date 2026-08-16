import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateWalkthroughIngress,
  walkthroughRequestRoutes,
} from "./walkthroughRequests";
import { readBoundedBody } from "./boundedBody";

/**
 * Admission runs its own internal mutation before the handler, so "did the
 * route persist anything" is now a question about the walkthrough mutation
 * specifically rather than about `runMutation` being called at all. The
 * acceptance call is the only one carrying a submission key.
 */
const acceptCalls = (runMutation: ReturnType<typeof vi.fn>) =>
  runMutation.mock.calls.filter(
    (call) => (call[1] as { submissionKey?: string })?.submissionKey,
  );

const validBody = {
  submissionKey: "01JABCDEFGHIJKLMNOPQRSTUVWX",
  name: "Ada Owner",
  workEmail: "ada@example.com",
  businessName: "Ada Goods",
  businessNeed: "Understand sales and inventory pressure.",
  website: "",
};

beforeEach(() => {
  process.env.WALKTHROUGH_ALLOWED_ORIGINS = "https://athena.example";
  process.env.WALKTHROUGH_HMAC_ACTIVE_VERSION = "v1";
  process.env.WALKTHROUGH_HMAC_ACTIVE_SECRET =
    "route-test-secret-with-at-least-32-bytes";
  process.env.WALKTHROUGH_PRIVACY_CONTACT = "privacy@athena.example";
});

afterEach(() => {
  delete process.env.WALKTHROUGH_ALLOWED_ORIGINS;
  delete process.env.WALKTHROUGH_HMAC_ACTIVE_VERSION;
  delete process.env.WALKTHROUGH_HMAC_ACTIVE_SECRET;
  delete process.env.WALKTHROUGH_PRIVACY_CONTACT;
});

describe("walkthrough HTTP ingress", () => {
  it.each([
    [
      {
        origin: "https://evil.example",
        contentType: "application/json",
        contentLength: 10,
      },
      403,
    ],
    [
      {
        origin: "https://athena.example",
        contentType: "text/plain",
        contentLength: 10,
      },
      415,
    ],
    [
      {
        origin: "https://athena.example",
        contentType: "application/json",
        contentLength: 99_999,
      },
      413,
    ],
  ])("rejects invalid requests before mutation", async (input, status) => {
    const runMutation = vi.fn();
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: input.origin,
          "content-type": input.contentType,
          "content-length": String(input.contentLength),
        },
        body: JSON.stringify(validBody),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(status);
    expect(acceptCalls(runMutation)).toHaveLength(0);
  });

  it("accepts an exact allowlisted JSON origin", () => {
    expect(
      evaluateWalkthroughIngress({
        origin: "https://athena.example",
        contentType: "application/json; charset=utf-8",
        contentLength: 500,
        allowedOrigins: ["https://athena.example"],
        maxBytes: 8_192,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a honeypot without persistence", async () => {
    const runMutation = vi.fn();
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...validBody, website: "bot.example" }),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(acceptCalls(runMutation)).toHaveLength(0);
  });

  it("returns only durable acceptance after the internal mutation accepts", async () => {
    const runMutation = vi.fn().mockResolvedValue({ accepted: true });
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(acceptCalls(runMutation)).toHaveLength(1);
  });

  it("keeps ingress closed until the privacy contact is configured", async () => {
    delete process.env.WALKTHROUGH_PRIVACY_CONTACT;
    const runMutation = vi.fn();
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "temporarily_unavailable" },
    });
    expect(acceptCalls(runMutation)).toHaveLength(0);
  });

  it.each([
    [
      { accepted: false, reason: "retry" },
      503,
      { error: { code: "retry_required" } },
    ],
    [
      { accepted: false, reason: "unavailable" },
      503,
      { error: { code: "temporarily_unavailable" } },
    ],
  ])(
    "keeps non-accepted outcomes generic",
    async (mutationResult, status, expectedBody) => {
      const response = await walkthroughRequestRoutes.request(
        "/",
        {
          method: "POST",
          headers: {
            origin: "https://athena.example",
            "content-type": "application/json",
          },
          body: JSON.stringify(validBody),
        },
        { runMutation: vi.fn().mockResolvedValue(mutationResult) } as never,
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual(expectedBody);
    },
  );

  it("keeps an internal mutation failure recoverable", async () => {
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody),
      },
      {
        // Admission succeeds; only the persistence call fails, and its private
        // detail must not reach the caller.
        runMutation: vi
          .fn()
          .mockImplementation((_reference, args) =>
            (args as { submissionKey?: string })?.submissionKey
              ? Promise.reject(new Error("private detail"))
              : Promise.resolve({}),
          ),
      } as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "temporarily_unavailable" },
    });
  });

  it("rejects invalid fields before invoking persistence", async () => {
    const runMutation = vi.fn();
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://athena.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...validBody, businessNeed: "short" }),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(400);
    expect(acceptCalls(runMutation)).toHaveLength(0);
  });

  it("hashes the same canonical payload that persistence normalizes", async () => {
    const runMutation = vi.fn().mockResolvedValue({ accepted: true });
    for (const businessName of ["Ada\u0000 Goods", "Ada Goods"]) {
      const response = await walkthroughRequestRoutes.request(
        "/",
        {
          method: "POST",
          headers: {
            origin: "https://athena.example",
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...validBody, businessName }),
        },
        { runMutation } as never,
      );
      expect(response.status).toBe(202);
    }

    const digests = acceptCalls(runMutation).map(
      (call) => (call[1] as { payloadDigest: string }).payloadDigest,
    );
    expect(digests[0]).toBe(digests[1]);
  });

  it("stops reading a body as soon as the streaming limit is exceeded", async () => {
    let cancelled = false;
    const request = new Request("https://athena.example", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(700));
          controller.enqueue(new Uint8Array(700));
        },
        cancel() {
          cancelled = true;
        },
      }),
      // Required by Node's Request implementation for a streaming body.
      duplex: "half",
    } as RequestInit);

    await expect(readBoundedBody(request, 1_024)).resolves.toBeNull();
    expect(cancelled).toBe(true);
  });

  it("admits nothing when the marketing origin is not allowlisted", async () => {
    const runMutation = vi.fn();
    const response = await walkthroughRequestRoutes.request(
      "/",
      {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(validBody),
      },
      { runMutation } as never,
    );

    expect(response.status).toBe(403);
    // The declared verifier runs before the admission mutation, so a rejected
    // request leaves no admission row and no capture behind it.
    expect(runMutation).not.toHaveBeenCalled();
  });
});
