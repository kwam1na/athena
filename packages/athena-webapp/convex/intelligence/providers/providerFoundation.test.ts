import { describe, expect, it, vi } from "vitest";
import { ATHENA_STRUCTURED_TEXT_V1 } from "../types";
import {
  createAthenaProviderRegistry,
  invokeStructuredTextProvider,
} from "../registry";
import { createFakeStructuredTextProvider } from "./fake";
import { createTanStackStructuredTextProvider } from "./tanstack";
import type { AthenaStructuredTextRequest } from "../types";

const request: AthenaStructuredTextRequest = {
  capability: ATHENA_STRUCTURED_TEXT_V1,
  messages: [{ role: "user", content: "Summarize storefront activity." }],
  outputSchema: {
    name: "StoreInsight",
    jsonSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
    },
  },
};

describe("Athena intelligence provider foundation", () => {
  it("runs a fake structured text provider without raw provider payloads", async () => {
    const onRequest = vi.fn();
    const registry = createAthenaProviderRegistry([
      createFakeStructuredTextProvider({
        output: { summary: "Traffic was steady.", recommendations: [] },
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        onRequest,
      }),
    ]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "fake",
      request,
    });

    expect(onRequest).toHaveBeenCalledWith(request);
    expect(result).toMatchObject({
      status: "succeeded",
      output: { summary: "Traffic was steady.", recommendations: [] },
      metadata: {
        providerId: "fake",
        modelId: "fake-structured-text-v1",
        capability: ATHENA_STRUCTURED_TEXT_V1,
        usage: { totalTokens: 20 },
      },
    });
    expect(result).not.toHaveProperty("rawPayload");
  });

  it("normalizes unavailable config before making a provider call", async () => {
    const onRequest = vi.fn();
    const registry = createAthenaProviderRegistry([
      createFakeStructuredTextProvider({
        mode: "unavailable_config",
        onRequest,
      }),
    ]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "fake",
      request,
    });

    expect(onRequest).not.toHaveBeenCalled();
    expect(result.status).toBe("unavailable_config");
    expect(result).toMatchObject({
      error: {
        code: "unavailable_config",
        retryable: false,
      },
    });
  });

  it("gates unsupported capabilities", async () => {
    const registry = createAthenaProviderRegistry([
      createFakeStructuredTextProvider({ capabilities: [] }),
    ]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "fake",
      request,
    });

    expect(result.status).toBe("unsupported_capability");
    expect(result).toMatchObject({
      error: {
        code: "unsupported_capability",
        retryable: false,
      },
    });
  });

  it("normalizes provider exceptions as provider failure", async () => {
    const registry = createAthenaProviderRegistry([
      createFakeStructuredTextProvider({ mode: "provider_failure" }),
    ]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "fake",
      request,
    });

    expect(result.status).toBe("provider_failure");
    expect(result).toMatchObject({
      error: {
        code: "provider_failure",
        message: "The intelligence provider could not complete the request.",
        retryable: true,
      },
    });
  });

  it("rejects invalid structured output", async () => {
    const registry = createAthenaProviderRegistry([
      createFakeStructuredTextProvider({ mode: "invalid_output" }),
    ]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "fake",
      request,
    });

    expect(result.status).toBe("invalid_output");
    expect(result).toMatchObject({
      error: {
        code: "invalid_output",
        retryable: false,
      },
    });
  });

  it("keeps the TanStack adapter import-safe when config is unavailable", async () => {
    const provider = createTanStackStructuredTextProvider({
      modelId: "gpt-4.1-nano",
    });
    const registry = createAthenaProviderRegistry([provider]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "tanstack",
      request,
    });

    expect(result.status).toBe("unavailable_config");
  });

  it("can wrap injected TanStack structured output without importing the package", async () => {
    const chat = vi.fn(async () => ({ object: { summary: "Injected adapter worked." } }));
    const openaiText = vi.fn(() => ({ provider: "openai" }));
    const provider = createTanStackStructuredTextProvider({
      modelId: "gpt-4.1-nano",
      apiKey: "test-key",
      loadTanStackAi: async () => ({ chat }),
      loadProviderAdapter: async () => ({ openaiText }),
    });
    const registry = createAthenaProviderRegistry([provider]);

    const result = await invokeStructuredTextProvider({
      registry,
      providerId: "tanstack",
      request,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      output: { summary: "Injected adapter worked." },
      metadata: {
        providerId: "tanstack",
        modelId: "gpt-4.1-nano",
        capability: ATHENA_STRUCTURED_TEXT_V1,
      },
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        outputSchema: request.outputSchema.jsonSchema,
        stream: false,
      })
    );
  });
});

