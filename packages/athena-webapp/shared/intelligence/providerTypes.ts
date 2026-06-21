export const ATHENA_STRUCTURED_TEXT_V1 = "structured_text.v1" as const;

export type AthenaIntelligenceCapability = typeof ATHENA_STRUCTURED_TEXT_V1;

export const ATHENA_PROVIDER_ERROR_CODES = [
  "unavailable_config",
  "unsupported_capability",
  "provider_failure",
  "invalid_output",
] as const;

export type AthenaProviderErrorCode = (typeof ATHENA_PROVIDER_ERROR_CODES)[number];

export type AthenaProviderCallStatus = "succeeded" | AthenaProviderErrorCode;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type AthenaStructuredTextSchema = {
  readonly name: string;
  readonly description?: string;
  readonly jsonSchema: JsonObject;
};

export type AthenaStructuredTextMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type AthenaStructuredTextRequest = {
  readonly capability: typeof ATHENA_STRUCTURED_TEXT_V1;
  readonly messages: readonly AthenaStructuredTextMessage[];
  readonly outputSchema: AthenaStructuredTextSchema;
  readonly modelId?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: JsonObject;
};

export type AthenaProviderUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostMicros?: number;
  readonly currency?: string;
};

export type AthenaProviderMetadata = {
  readonly providerId: string;
  readonly modelId?: string;
  readonly capability: AthenaIntelligenceCapability;
  readonly usage?: AthenaProviderUsage;
};

export type AthenaProviderError = {
  readonly code: AthenaProviderErrorCode;
  readonly status: AthenaProviderErrorCode;
  readonly message: string;
  readonly providerId?: string;
  readonly capability?: AthenaIntelligenceCapability;
  readonly retryable: boolean;
};

export type AthenaStructuredTextSuccess = {
  readonly status: "succeeded";
  readonly output: JsonObject;
  readonly metadata: AthenaProviderMetadata;
};

export type AthenaStructuredTextFailure = {
  readonly status: AthenaProviderErrorCode;
  readonly error: AthenaProviderError;
  readonly metadata?: AthenaProviderMetadata;
};

export type AthenaStructuredTextResult =
  | AthenaStructuredTextSuccess
  | AthenaStructuredTextFailure;

export type AthenaProviderConfigStatus =
  | {
      readonly status: "available";
    }
  | {
      readonly status: "unavailable_config";
      readonly missingConfigKeys?: readonly string[];
      readonly message?: string;
    };

export type AthenaProviderDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly capabilities: readonly AthenaIntelligenceCapability[];
  readonly configStatus: AthenaProviderConfigStatus;
  readonly defaultModelId?: string;
};

export type AthenaStructuredTextProvider = {
  readonly descriptor: AthenaProviderDescriptor;
  readonly generateStructuredText: (
    request: AthenaStructuredTextRequest
  ) => Promise<AthenaStructuredTextResult>;
};

