import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedRender = vi.hoisted(() => vi.fn(async () => "<html />"));

vi.mock("@react-email/components", () => ({
  render: mockedRender,
}));

import {
  sendNewOrderEmail,
  sendOrderEmail,
  sendVerificationCode,
} from "./index";

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

describe("MailerSend customer order delivery", () => {
  beforeEach(() => {
    mockedRender.mockClear();
  });

  it("renders the production order component with the supplied order facts", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendOrderEmail({
      type: "confirmation",
      customerEmail: "customer@example.com",
      store_name: "Wigclub",
      order_number: "WC-100",
      order_date: "July 17, 2026",
      order_status_messaging: "We received your order.",
      total: "GH₵500",
      subtotal: "GH₵500",
      items: [],
      pickup_type: "Pickup",
      pickup_details: "East Legon",
      customer_name: "Ama",
    });

    const calls = mockedRender.mock.calls as unknown as Array<[
      { props?: Record<string, unknown> },
    ]>;
    expect(calls[0]?.[0].props).toMatchObject({
      customerEmail: "customer@example.com",
      items: [],
      order_number: "WC-100",
      total: "GH₵500",
      type: "confirmation",
    });
    expect(getRequestBody(fetchMock)).toMatchObject({
      subject: "Your Wigclub order",
      to: [{ email: "customer@example.com", name: "Ama" }],
    });
  });

  it("renders the production admin order component with the supplied order facts", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendNewOrderEmail({
      store_name: "Wigclub",
      order_amount: "GH₵500",
      order_status: "pending",
      order_date: "July 17, 2026",
      customer_name: "Ama",
      order_id: "order-100",
      order_number: "WC-100",
      items: [],
      delivery_method: "Pickup",
      delivery_details: "East Legon",
      subtotal: "GH₵500",
    });

    const calls = mockedRender.mock.calls as unknown as Array<[
      { props?: Record<string, unknown> },
    ]>;
    expect(calls[0]?.[0].props).toMatchObject({
      appUrl: expect.stringContaining("/orders/order-100"),
      items: [],
      order_amount: "GH₵500",
      order_number: "WC-100",
    });
    expect(getRequestBody(fetchMock)).toMatchObject({
      subject: "🎉 GH₵500 order received",
    });
  });
});
