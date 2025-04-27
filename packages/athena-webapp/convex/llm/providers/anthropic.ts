import Anthropic from "@anthropic-ai/sdk";

export async function callAnthropic({
  prompt,
  model = "claude-3-5-haiku-20241022", // Default to Claude 3 Opus, adjust as needed
  temperature = 1,
  maxTokens = 1024,
}: {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const completion = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  // Anthropic's SDK returns the assistant response in content (which can be an array of content blocks).
  // Here, we join all text content blocks for a single string output.
  return Array.isArray(completion.content)
    ? completion.content
        .map((c) =>
          typeof c === "string" ? c : c.type === "text" ? c.text : ""
        )
        .join("\n")
    : completion.content;
}
