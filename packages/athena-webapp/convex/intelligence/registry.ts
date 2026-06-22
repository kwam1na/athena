import {
  ATHENA_STRUCTURED_TEXT_V1,
  type AthenaIntelligenceCapability,
  type AthenaProviderDescriptor,
  type AthenaProviderError,
  type AthenaProviderErrorCode,
  type AthenaStructuredTextProvider,
  type AthenaStructuredTextRequest,
  type AthenaStructuredTextResult,
  type JsonObject,
  type JsonValue,
} from "./types";

const SAFE_PROVIDER_ERROR_MESSAGES: Record<AthenaProviderErrorCode, string> = {
  unavailable_config: "The intelligence provider is not configured.",
  unsupported_capability: "The intelligence provider does not support this capability.",
  provider_failure: "The intelligence provider could not complete the request.",
  invalid_output: "The intelligence provider returned output Athena could not use.",
};

export function createAthenaProviderError({
  code,
  providerId,
  capability,
  retryable,
  message,
  diagnostic,
}: {
  code: AthenaProviderErrorCode;
  providerId?: string;
  capability?: AthenaIntelligenceCapability;
  retryable?: boolean;
  message?: string;
  diagnostic?: string;
}): AthenaProviderError {
  return {
    code,
    status: code,
    message: message ?? SAFE_PROVIDER_ERROR_MESSAGES[code],
    diagnostic,
    providerId,
    capability,
    retryable: retryable ?? code === "provider_failure",
  };
}

export function createProviderFailureResult({
  code,
  provider,
  capability,
  retryable,
  message,
  diagnostic,
}: {
  code: AthenaProviderErrorCode;
  provider?: AthenaStructuredTextProvider;
  capability?: AthenaIntelligenceCapability;
  retryable?: boolean;
  message?: string;
  diagnostic?: string;
}): AthenaStructuredTextResult {
  return {
    status: code,
    error: createAthenaProviderError({
      code,
      providerId: provider?.descriptor.id,
      capability,
      retryable,
      message,
      diagnostic,
    }),
    metadata: provider
      ? {
          providerId: provider.descriptor.id,
          modelId: provider.descriptor.defaultModelId,
          capability: capability ?? ATHENA_STRUCTURED_TEXT_V1,
        }
      : undefined,
  };
}

export function createAthenaProviderRegistry(
  providers: readonly AthenaStructuredTextProvider[]
): ReadonlyMap<string, AthenaStructuredTextProvider> {
  const registry = new Map<string, AthenaStructuredTextProvider>();

  for (const provider of providers) {
    if (registry.has(provider.descriptor.id)) {
      throw new Error(`Duplicate intelligence provider: ${provider.descriptor.id}`);
    }
    registry.set(provider.descriptor.id, provider);
  }

  return registry;
}

export function listAthenaProviderDescriptors(
  registry: ReadonlyMap<string, AthenaStructuredTextProvider>
): AthenaProviderDescriptor[] {
  return Array.from(registry.values()).map((provider) => provider.descriptor);
}

export async function invokeStructuredTextProvider({
  registry,
  providerId,
  request,
}: {
  registry: ReadonlyMap<string, AthenaStructuredTextProvider>;
  providerId: string;
  request: AthenaStructuredTextRequest;
}): Promise<AthenaStructuredTextResult> {
  const provider = registry.get(providerId);

  if (!provider) {
    return createProviderFailureResult({
      code: "unavailable_config",
      capability: request.capability,
      message: "No configured intelligence provider matched the requested provider id.",
    });
  }

  if (provider.descriptor.configStatus.status !== "available") {
    return createProviderFailureResult({
      code: "unavailable_config",
      provider,
      capability: request.capability,
      retryable: false,
    });
  }

  if (!provider.descriptor.capabilities.includes(request.capability)) {
    return createProviderFailureResult({
      code: "unsupported_capability",
      provider,
      capability: request.capability,
      retryable: false,
    });
  }

  if (request.capability !== ATHENA_STRUCTURED_TEXT_V1) {
    return createProviderFailureResult({
      code: "unsupported_capability",
      provider,
      capability: request.capability,
      retryable: false,
    });
  }

  try {
    const result = await provider.generateStructuredText(request);

    if (result.status !== "succeeded") {
      return result;
    }

    if (!isJsonObject(result.output)) {
      return createProviderFailureResult({
        code: "invalid_output",
        provider,
        capability: request.capability,
        retryable: false,
      });
    }

    return result;
  } catch (error) {
    return createProviderFailureResult({
      code: "provider_failure",
      provider,
      capability: request.capability,
      retryable: true,
      diagnostic: getProviderFailureDiagnostic(error),
    });
  }
}

export function getProviderFailureDiagnostic(error: unknown) {
  if (!(error instanceof Error)) return undefined;

  return sanitizeDiagnostic(error.message);
}

export function sanitizeDiagnostic(message: string) {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 500);
}

export function isJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonObject(value);
}
