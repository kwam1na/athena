import { describe, expect, it, vi } from "vitest";
import {
  createCollectionsAccessToken,
  getRequestToPayStatus,
  requestToPay,
} from "./client";

const baseConfig = {
  subscriptionKey: "test-subscription-key",
  apiUser: "test-user",
  apiKey: "test-password",
  targetEnvironment: "sandbox" as const,
  baseUrl: "https://sandbox.momodeveloper.mtn.com",
  callbackHost: "https://athena.example.com",
  callbackPath: "/webhooks/mtn-momo/collections",
};

describe("MTN collections client", () => {
  it("creates an access token with basic auth and the collections subscription key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-123",
        token_type: "access_token",
        expires_in: 3600,
      }),
    });

    const result = await createCollectionsAccessToken(
      baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.momodeveloper.mtn.com/collection/token/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa("test-user:test-password")}`,
          "Ocp-Apim-Subscription-Key": "test-subscription-key",
        }),
      }),
    );
    expect(result).toEqual({
      accessToken: "token-123",
      tokenType: "access_token",
      expiresInSeconds: 3600,
    });
  });

  it("submits request-to-pay calls with the callback url and generated reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "",
    });

    const result = await requestToPay(
      baseConfig,
      "token-123",
      {
        providerReference: "provider-ref-123",
        callbackUrl:
          "https://athena.example.com/webhooks/mtn-momo/collections?storeId=store_123&providerReference=provider-ref-123",
        amount: "1500",
        currency: "EUR",
        externalId: "order-001",
        payer: {
          partyIdType: "MSISDN",
          partyId: "233555123456",
        },
        payerMessage: "Order Payment",
        payeeNote: "Order Payment",
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "Ocp-Apim-Subscription-Key": "test-subscription-key",
          "X-Reference-Id": "provider-ref-123",
          "X-Callback-Url":
            "https://athena.example.com/webhooks/mtn-momo/collections?storeId=store_123&providerReference=provider-ref-123",
          "X-Target-Environment": "sandbox",
        }),
        body: JSON.stringify({
          amount: "1500",
          currency: "EUR",
          externalId: "order-001",
          payer: {
            partyIdType: "MSISDN",
            partyId: "233555123456",
          },
          payerMessage: "Order Payment",
          payeeNote: "Order Payment",
        }),
      }),
    );
    expect(result).toEqual({
      providerReference: "provider-ref-123",
      accepted: true,
      statusCode: 202,
    });
  });

  it("retrieves request-to-pay status with the provider reference path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        financialTransactionId: "fin-123",
        externalId: "order-001",
        amount: "1500",
        currency: "EUR",
        payer: {
          partyIdType: "MSISDN",
          partyId: "233555123456",
        },
        payerMessage: "Order Payment",
        payeeNote: "Order Payment",
        status: "SUCCESSFUL",
      }),
    });

    const result = await getRequestToPayStatus(
      baseConfig,
      "token-123",
      "provider-ref-123",
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/provider-ref-123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
          "Ocp-Apim-Subscription-Key": "test-subscription-key",
          "X-Target-Environment": "sandbox",
        }),
      }),
    );
    expect(result).toMatchObject({
      financialTransactionId: "fin-123",
      status: "SUCCESSFUL",
      externalId: "order-001",
    });
  });
});
