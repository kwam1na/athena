import {
  MtnCollectionsConfig,
  MtnCollectionsStatusPayload,
  MtnParty,
} from "./types";

type FetchLike = typeof fetch;

const encodeBasicAuth = (value: string): string => {
  return btoa(value);
};

const toError = async (response: Response): Promise<Error> => {
  const body = await response.text();
  return new Error(
    `MTN collections request failed with ${response.status}: ${body || response.statusText}`,
  );
};

const buildHeaders = (
  config: MtnCollectionsConfig,
  accessToken: string,
): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "Ocp-Apim-Subscription-Key": config.subscriptionKey,
  "X-Target-Environment": config.targetEnvironment,
});

export async function createCollectionsAccessToken(
  config: MtnCollectionsConfig,
  fetchImpl: FetchLike = fetch,
): Promise<{
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
}> {
  const response = await fetchImpl(`${config.baseUrl}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(
        `${config.apiUser}:${config.apiKey}`,
      )}`,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
    },
  });

  if (!response.ok) {
    throw await toError(response);
  }

  const payload = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresInSeconds: payload.expires_in,
  };
}

export async function requestToPay(
  config: MtnCollectionsConfig,
  accessToken: string,
  input: {
    providerReference: string;
    callbackUrl: string;
    amount: string;
    currency: string;
    externalId: string;
    payer: MtnParty;
    payerMessage: string;
    payeeNote: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<{
  providerReference: string;
  accepted: true;
  statusCode: number;
}> {
  const response = await fetchImpl(
    `${config.baseUrl}/collection/v1_0/requesttopay`,
    {
      method: "POST",
      headers: {
        ...buildHeaders(config, accessToken),
        "X-Callback-Url": input.callbackUrl,
        "X-Reference-Id": input.providerReference,
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        externalId: input.externalId,
        payer: input.payer,
        payerMessage: input.payerMessage,
        payeeNote: input.payeeNote,
      }),
    },
  );

  if (!response.ok) {
    throw await toError(response);
  }

  return {
    providerReference: input.providerReference,
    accepted: true,
    statusCode: response.status,
  };
}

export async function getRequestToPayStatus(
  config: MtnCollectionsConfig,
  accessToken: string,
  providerReference: string,
  fetchImpl: FetchLike = fetch,
): Promise<MtnCollectionsStatusPayload> {
  const response = await fetchImpl(
    `${config.baseUrl}/collection/v1_0/requesttopay/${providerReference}`,
    {
      method: "GET",
      headers: buildHeaders(config, accessToken),
    },
  );

  if (!response.ok) {
    throw await toError(response);
  }

  return (await response.json()) as MtnCollectionsStatusPayload;
}
