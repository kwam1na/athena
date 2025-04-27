import OpenAI from "openai";

export async function callOpenAi({ prompt }: { prompt: string }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-nano-2025-04-14",
    messages: [{ role: "user", content: prompt }],
    temperature: 1,
  });
  return completion.choices?.[0]?.message?.content;
}
