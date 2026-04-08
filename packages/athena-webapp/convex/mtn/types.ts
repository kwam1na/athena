export type MtnCollectionsTargetEnvironment = "sandbox" | "production";

export type MtnCollectionsConfig = {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: MtnCollectionsTargetEnvironment;
  baseUrl: string;
  callbackHost: string;
  callbackPath: string;
};

export type MtnCollectionsConfigResult =
  | {
      kind: "configured";
      config: MtnCollectionsConfig;
      lookupPrefixes: string[];
    }
  | {
      kind: "not_configured";
      missing: string[];
      lookupPrefixes: string[];
    };

export type MtnParty = {
  partyIdType: string;
  partyId: string;
};

export type MtnCollectionsStatusPayload = {
  financialTransactionId?: string;
  externalId?: string;
  amount?: string;
  currency?: string;
  payer?: MtnParty;
  payerMessage?: string;
  payeeNote?: string;
  status: string;
  reason?: string;
};
