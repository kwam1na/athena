import { afterEach, describe, expect, it, vi } from "vitest";

import { sendNotificationEmail } from "./transport";

const request = {
  deliveryId: "delivery-1",
  recipientEmail: "admin@example.com",
  recipientName: "Admin",
  subject: "Test subject",
  html: "<p>Hello</p>",
};

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => {
      if (response instanceof Error) throw response;
      return response;
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendNotificationEmail", () => {
  it("sends to the real recipient in prod with the delivery-id idempotency key", async () => {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    const fetchMock = stubFetch(
      new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }),
    );

    const result = await sendNotificationEmail(request);

    expect(result).toEqual({
      state: "sent",
      code: "sent",
      providerMessageId: "msg-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.mailersend.com/v1/email");
    const headers = init!.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("delivery-1");
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init!.body));
    expect(body.to).toEqual([
      { email: "admin@example.com", name: "Admin" },
    ]);
    expect(body.subject).toBe("Test subject");
  });

  it("suppresses without any provider call in non-prod when no dev recipient is set", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("NOTIFICATIONS_DEV_RECIPIENT", "");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    const fetchMock = stubFetch(new Response(null, { status: 202 }));

    const result = await sendNotificationEmail(request);

    expect(result).toEqual({
      state: "sent",
      code: "suppressed_non_prod",
      providerMessageId: "suppressed:non-prod",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirects to the dev recipient in non-prod, not the real recipient", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("NOTIFICATIONS_DEV_RECIPIENT", "dev-inbox@example.com");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    const fetchMock = stubFetch(new Response(null, { status: 202 }));

    const result = await sendNotificationEmail(request);

    expect(result.state).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.to).toEqual([
      { email: "dev-inbox@example.com", name: "Athena notifications (dev)" },
    ]);
  });

  it("reports terminal missing_configuration in prod without an API key", async () => {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("MAILERSEND_API_KEY", "");
    const fetchMock = stubFetch(new Response(null, { status: 202 }));

    const result = await sendNotificationEmail(request);

    expect(result).toEqual({
      state: "terminal_failure",
      code: "missing_configuration",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies a rejected fetch as retryable provider_timeout", async () => {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    stubFetch(new Error("network down"));

    const result = await sendNotificationEmail(request);

    expect(result).toEqual({
      state: "retryable_failure",
      code: "provider_timeout",
    });
  });

  it("classifies provider 5xx responses as retryable", async () => {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    stubFetch(new Response(null, { status: 500 }));

    const result = await sendNotificationEmail(request);

    expect(result.state).toBe("retryable_failure");
    expect(result.code).toBe("provider_500");
  });
});
