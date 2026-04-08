import { describe, expect, it } from "vitest";
import {
  maskMtnPartyId,
  normalizeCollectionsTransaction,
  parseCollectionsNotificationRequest,
} from "./normalize";

describe("MTN collections normalization", () => {
  it("normalizes provider status payloads into store-scoped transaction records", () => {
    const record = normalizeCollectionsTransaction({
      storeId: "store_123",
      providerReference: "provider-ref-123",
      requestedAt: 1_712_345_678_000,
      statusPayload: {
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
      },
      observedAt: 1_712_345_679_000,
      callbackMetadata: {
        method: "POST",
        receivedAt: 1_712_345_679_000,
      },
    });

    expect(record).toEqual({
      storeId: "store_123",
      providerReference: "provider-ref-123",
      externalId: "order-001",
      externalTransactionId: "fin-123",
      status: "SUCCESSFUL",
      amount: 1500,
      currency: "EUR",
      requestedAt: 1_712_345_678_000,
      completedAt: 1_712_345_679_000,
      payerPartyIdType: "MSISDN",
      payerIdentifierMasked: "********3456",
      payerMessage: "Order Payment",
      payeeNote: "Order Payment",
      callbackMetadata: {
        method: "POST",
        receivedAt: 1_712_345_679_000,
      },
    });
  });

  it("parses callback requests and rejects malformed payloads", () => {
    expect(
      parseCollectionsNotificationRequest({
        rawBody: JSON.stringify({
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
        headers: {
          "content-type": "application/json",
        },
        query: {
          storeId: "store_123",
          providerReference: "provider-ref-123",
        },
        method: "POST",
      }),
    ).toEqual({
      ok: true,
      value: {
        storeId: "store_123",
        providerReference: "provider-ref-123",
        payload: {
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
        },
        callbackMetadata: {
          contentType: "application/json",
          method: "POST",
          referenceIdHeader: undefined,
        },
      },
    });

    expect(
      parseCollectionsNotificationRequest({
        rawBody: JSON.stringify({ status: "SUCCESSFUL" }),
        headers: {},
        query: {
          storeId: "store_123",
        },
        method: "POST",
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "Missing provider reference",
    });
  });

  it("masks payer identifiers for audit-safe storage", () => {
    expect(maskMtnPartyId("233555123456")).toBe("********3456");
    expect(maskMtnPartyId("1234")).toBe("1234");
  });
});
