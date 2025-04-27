import { callOpenAi } from "./providers/openai";
import { callAnthropic } from "./providers/anthropic";

export async function callLlmProvider({
  prompt,
  provider,
}: {
  prompt: string;
  provider: string;
}) {
  switch (provider) {
    case "openai":
      return callOpenAi({ prompt });
    case "anthropic":
      return callAnthropic({ prompt });
    default:
      throw new Error("Unsupported LLM provider");
  }
}
