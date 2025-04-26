import { callOpenAi } from "./providers/openai";
// import { callAnthropic } from "./providers/anthropic"; // for future use

export async function callLlmProvider({
  prompt,
  provider,
  apiKey,
}: {
  prompt: string;
  provider: string;
  apiKey: string;
}) {
  switch (provider) {
    case "openai":
      return callOpenAi({ prompt, apiKey });
    // case "anthropic":
    //   return callAnthropic({ prompt, apiKey });
    default:
      throw new Error("Unsupported LLM provider");
  }
}
