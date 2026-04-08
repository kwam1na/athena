import { MtnCollectionsStatusPayload } from "./types";

const FINAL_STATUSES = new Set([
  "FAILED",
  "REJECTED",
  "SUCCESSFUL",
  "TIMEOUT",
]);

export const maskMtnPartyId = (partyId: string): string => {
  if (partyId.length <= 4) {
    return partyId;
  }

  return `${"*".repeat(partyId.length - 4)}${partyId.slice(-4)}`;
};

export const normalizeCollectionsTransaction = (input: {
  storeId: string;
  providerReference: string;
  requestedAt: number;
  statusPayload: MtnCollectionsStatusPayload;
  observedAt: number;
  callbackMetadata?: Record<string, any>;
}): Record<string, any> => {
  const amount =
    typeof input.statusPayload.amount === "string"
      ? Number.parseInt(input.statusPayload.amount, 10)
      : undefined;
  const status = input.statusPayload.status;

  return {
    storeId: input.storeId,
    providerReference: input.providerReference,
    externalId: input.statusPayload.externalId,
    externalTransactionId: input.statusPayload.financialTransactionId,
    status,
    amount,
    currency: input.statusPayload.currency,
    requestedAt: input.requestedAt,
    completedAt: FINAL_STATUSES.has(status) ? input.observedAt : undefined,
    payerPartyIdType: input.statusPayload.payer?.partyIdType,
    payerIdentifierMasked: input.statusPayload.payer?.partyId
      ? maskMtnPartyId(input.statusPayload.payer.partyId)
      : undefined,
    payerMessage: input.statusPayload.payerMessage,
    payeeNote: input.statusPayload.payeeNote,
    callbackMetadata: input.callbackMetadata,
  };
};

export const parseCollectionsNotificationRequest = (input: {
  rawBody: string;
  headers: Record<string, string | undefined>;
  query: {
    storeId?: string;
    providerReference?: string;
  };
  method: string;
}):
  | {
      ok: true;
      value: {
        storeId: string;
        providerReference: string;
        payload: MtnCollectionsStatusPayload;
        callbackMetadata: Record<string, any>;
      };
    }
  | {
      ok: false;
      statusCode: 400;
      error: string;
    } => {
  let payload: unknown;

  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return {
      ok: false,
      statusCode: 400,
      error: "Invalid MTN callback payload",
    };
  }

  if (!input.query.storeId) {
    return {
      ok: false,
      statusCode: 400,
      error: "Missing store identifier",
    };
  }

  const payloadRecord =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, any>)
      : null;

  if (!payloadRecord || typeof payloadRecord.status !== "string") {
    return {
      ok: false,
      statusCode: 400,
      error: "Malformed MTN callback payload",
    };
  }

  const providerReference =
    input.query.providerReference ?? input.headers["x-reference-id"];

  if (!providerReference) {
    return {
      ok: false,
      statusCode: 400,
      error: "Missing provider reference",
    };
  }

  return {
    ok: true,
    value: {
      storeId: input.query.storeId,
      providerReference,
      payload: payloadRecord as MtnCollectionsStatusPayload,
      callbackMetadata: {
        contentType: input.headers["content-type"],
        method: input.method,
        referenceIdHeader: input.headers["x-reference-id"],
      },
    },
  };
};
