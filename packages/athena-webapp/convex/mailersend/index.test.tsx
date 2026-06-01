import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedRender = vi.hoisted(() => vi.fn(async () => "<html />"));

vi.mock("@react-email/components", () => ({
  render: mockedRender,
}));

import { sendVerificationCode } from "./index";

function getRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

  expect(requestInit).toBeDefined();
  return JSON.parse(String(requestInit?.body));
}

function getRenderedVerificationEmailProps() {
  const calls = mockedRender.mock.calls as unknown as Array<[unknown]>;
  const renderedElement = calls[0]?.[0] as
    | { props?: Record<string, unknown> }
    | undefined;

  expect(renderedElement).toBeDefined();
  return renderedElement?.props ?? {};
}

describe("MailerSend verification code delivery", () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it("delivers POS auth emails to the configured forwarding inbox", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendVerificationCode({
      customerEmail: "pos@wigclub.store",
      storeName: "Athena",
      validTime: "20 minutes",
      verificationCode: "123456",
    });

    const body = getRequestBody(fetchMock);

    expect(body.to).toEqual([
      {
        email: "kwami.nuh@gmail.com",
        name: "",
      },
    ]);
    expect(getRenderedVerificationEmailProps().customerEmail).toBe(
      "pos@wigclub.store",
    );
  });

  it("keeps other auth email recipients unchanged", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendVerificationCode({
      customerEmail: "manager@example.com",
      storeName: "Athena",
      validTime: "20 minutes",
      verificationCode: "123456",
    });

    const body = getRequestBody(fetchMock);

    expect(body.to).toEqual([
      {
        email: "manager@example.com",
        name: "",
      },
    ]);
  });
});
