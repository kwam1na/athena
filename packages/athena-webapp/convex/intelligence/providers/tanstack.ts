import {
  ATHENA_STRUCTURED_TEXT_V1,
  type AthenaProviderConfigStatus,
  type AthenaStructuredTextProvider,
  type AthenaStructuredTextRequest,
  type AthenaStructuredTextResult,
  type JsonObject,
} from "../types";
import { createProviderFailureResult, isJsonObject } from "../registry";

type TanStackChat = (options: Record<string, unknown>) => Promise<unknown>;
type TanStackProviderFactory = (
  model: string,
  options?: Record<string, unknown>
) => unknown;
type TanStackOpenAiExplicitFactory = (
  model: string,
  apiKey: string,
  options?: Record<string, unknown>
) => unknown;

export type TanStackStructuredTextProviderOptions = {
  readonly id?: string;
  readonly label?: string;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly configStatus?: AthenaProviderConfigStatus;
  readonly loadTanStackAi?: () => Promise<{ chat?: TanStackChat }>;
  readonly loadProviderAdapter?: () => Promise<{
    openaiText?: TanStackProviderFactory;
    createOpenaiChat?: TanStackOpenAiExplicitFactory;
    provider?: TanStackProviderFactory;
  }>;
};

export function createTanStackStructuredTextProvider(
  options: TanStackStructuredTextProviderOptions
): AthenaStructuredTextProvider {
  const id = options.id ?? "tanstack";
  const configStatus =
    options.configStatus ??
    (options.apiKey
      ? ({ status: "available" } as const)
      : ({ status: "unavailable_config", missingConfigKeys: ["OPENAI_API_KEY"] } as const));

  return {
    descriptor: {
      id,
      label: options.label ?? "TanStack AI structured text",
      capabilities: [ATHENA_STRUCTURED_TEXT_V1],
      configStatus,
      defaultModelId: options.modelId,
    },
    generateStructuredText: async (request) => {
      if (configStatus.status !== "available") {
        return createProviderFailureResult({
          code: "unavailable_config",
          provider: createTanStackStructuredTextProvider(options),
          capability: request.capability,
          retryable: false,
        });
      }

      try {
        const [{ chat }, adapterModule] = await Promise.all([
          (options.loadTanStackAi ?? loadTanStackAi)(),
          (options.loadProviderAdapter ?? loadOpenAiAdapter)(),
        ]);
        const providerFactory = adapterModule.openaiText ?? adapterModule.provider;

        if (!chat || (!providerFactory && !adapterModule.createOpenaiChat)) {
          return createProviderFailureResult({
            code: "unavailable_config",
            provider: createTanStackStructuredTextProvider(options),
            capability: request.capability,
            retryable: false,
          });
        }
        const adapter =
          options.apiKey && adapterModule.createOpenaiChat
            ? adapterModule.createOpenaiChat(
                request.modelId ?? options.modelId,
                options.apiKey
              )
            : providerFactory?.(request.modelId ?? options.modelId);

        const result = await chat({
          adapter,
          messages: request.messages,
          outputSchema: request.outputSchema.jsonSchema,
          stream: false,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        });
        const output = extractStructuredOutput(result);

        if (!isJsonObject(output)) {
          return createProviderFailureResult({
            code: "invalid_output",
            provider: createTanStackStructuredTextProvider(options),
            capability: request.capability,
            retryable: false,
          });
        }

        return {
          status: "succeeded",
          output,
          metadata: {
            providerId: id,
            modelId: request.modelId ?? options.modelId,
            capability: request.capability,
          },
        };
      } catch {
        return createProviderFailureResult({
          code: "provider_failure",
          provider: createTanStackStructuredTextProvider(options),
          capability: request.capability,
          retryable: true,
        });
      }
    },
  };
}

function extractStructuredOutput(result: unknown): JsonObject | unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  const value = result as Record<string, unknown>;
  return value.object ?? value.output ?? value.data ?? value.result ?? result;
}

async function loadTanStackAi(): Promise<{ chat?: TanStackChat }> {
  const packageName = "@tanstack/ai";
  return import(packageName) as Promise<{ chat?: TanStackChat }>;
}

async function loadOpenAiAdapter(): Promise<{
  openaiText?: TanStackProviderFactory;
  createOpenaiChat?: TanStackOpenAiExplicitFactory;
  provider?: TanStackProviderFactory;
}> {
  const packageName = "@tanstack/ai-openai";
  return import(packageName) as Promise<{
    openaiText?: TanStackProviderFactory;
    createOpenaiChat?: TanStackOpenAiExplicitFactory;
    provider?: TanStackProviderFactory;
  }>;
}
