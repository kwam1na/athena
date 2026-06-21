import {
  ATHENA_STRUCTURED_TEXT_V1,
  type AthenaIntelligenceCapability,
  type AthenaProviderConfigStatus,
  type AthenaStructuredTextProvider,
  type AthenaStructuredTextRequest,
  type AthenaStructuredTextResult,
  type JsonObject,
} from "../types";
import { createProviderFailureResult } from "../registry";

type FakeProviderMode = "success" | "unavailable_config" | "provider_failure" | "invalid_output";

export type FakeStructuredTextProviderOptions = {
  readonly id?: string;
  readonly label?: string;
  readonly modelId?: string;
  readonly capabilities?: readonly AthenaIntelligenceCapability[];
  readonly configStatus?: AthenaProviderConfigStatus;
  readonly mode?: FakeProviderMode;
  readonly output?: JsonObject | unknown;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
  readonly onRequest?: (request: AthenaStructuredTextRequest) => void | Promise<void>;
};

export function createFakeStructuredTextProvider(
  options: FakeStructuredTextProviderOptions = {}
): AthenaStructuredTextProvider {
  const id = options.id ?? "fake";
  const modelId = options.modelId ?? "fake-structured-text-v1";
  const capabilities = options.capabilities ?? [ATHENA_STRUCTURED_TEXT_V1];
  const configStatus =
    options.configStatus ??
    (options.mode === "unavailable_config"
      ? ({ status: "unavailable_config", missingConfigKeys: ["FAKE_PROVIDER_ENABLED"] } as const)
      : ({ status: "available" } as const));

  return {
    descriptor: {
      id,
      label: options.label ?? "Fake intelligence provider",
      capabilities,
      configStatus,
      defaultModelId: modelId,
    },
    generateStructuredText: async (request) => {
      await options.onRequest?.(request);

      if (options.mode === "provider_failure") {
        throw new Error("Fake provider failure");
      }

      if (options.mode === "invalid_output") {
        return {
          status: "succeeded",
          output: (options.output ?? ["not", "an", "object"]) as JsonObject,
          metadata: {
            providerId: id,
            modelId,
            capability: request.capability,
          },
        };
      }

      if (configStatus.status !== "available") {
        return createProviderFailureResult({
          code: "unavailable_config",
          provider: {
            descriptor: {
              id,
              label: options.label ?? "Fake intelligence provider",
              capabilities,
              configStatus,
              defaultModelId: modelId,
            },
            generateStructuredText: async () =>
              createProviderFailureResult({ code: "unavailable_config" }),
          },
          capability: request.capability,
          retryable: false,
        });
      }

      return {
        status: "succeeded",
        output: (options.output ?? {
          summary: "Fake structured intelligence output.",
          recommendations: [],
        }) as JsonObject,
        metadata: {
          providerId: id,
          modelId,
          capability: request.capability,
          usage: options.usage,
        },
      } satisfies AthenaStructuredTextResult;
    },
  };
}

