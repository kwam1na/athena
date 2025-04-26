import { v } from "convex/values";
import { callLlmProvider } from "./callLlmProvider";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

export const getUserInsightsFromLlm = action({
  args: {
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? "openai";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const analytics = await ctx.runQuery(
      api.storeFront.user.getAllUserActivity,
      {
        id: args.storeFrontUserId,
      }
    );

    const prompt = `You are an analytics assistant. Given the following user actions, infer useful insights about the user's shopping behavior, engagement, and preferences.\n\nRespond ONLY with a valid JSON object, with no markdown, no explanation, and no extra text. The JSON should have these fields:\n- summary: a 1-2 sentence summary of the user\n- likely_intent: what is the user likely trying to do?\n- engagement_level: low/medium/high\n- device_preference: desktop/mobile/unknown\n- recommendations: array of 1-3 actionable recommendations for the business\n\nUser actions:\n${JSON.stringify(analytics)}`;

    const llmResponse = await callLlmProvider({ prompt, provider, apiKey });

    let insights;
    try {
      insights = llmResponse ? JSON.parse(llmResponse) : { summary: "" };
    } catch {
      insights = { summary: llmResponse };
    }
    return insights;
  },
});
