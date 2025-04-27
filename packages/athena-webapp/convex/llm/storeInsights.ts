import { v } from "convex/values";
import { callLlmProvider } from "./callLlmProvider";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { Analytic } from "../../types";
import {
  calculateDeviceDistribution,
  calculateActivityTrend,
} from "./utils/analyticsUtils";

export const getStoreInsightsFromLlm = action({
  args: {
    storeId: v.id("store"),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const provider = args.provider ?? "openai";

    const analytics = await ctx.runQuery(api.storeFront.analytics.getAll, {
      storeId: args.storeId,
    });

    // Calculate insights before sending to LLM
    const deviceDistribution = calculateDeviceDistribution(analytics);
    const activityTrend = calculateActivityTrend(analytics);

    const prompt = `You are an analytics assistant analyzing store-wide behavior patterns. Given the store's analytics data below, return ONLY a JSON object (no other text/markdown).

The response must be a valid JSON object with this exact structure:
{
  "summary": "Brief 2-3 sentence summary of store activity patterns",
  "peak_activity_times": "description of when most activity occurs",
  "popular_actions": ["array of top 3 most common user actions"],
  "device_distribution": ${JSON.stringify(deviceDistribution)},
  "activity_trend": "${activityTrend}",
  "recommendations": [
    "First actionable recommendation for store improvement",
    "Second actionable recommendation for store improvement",
    "Third actionable recommendation for store improvement"
  ]
}

Note: Device distribution and activity trend have been pre-calculated, use the provided values.

Analyze this store's analytics data and respond with a similar JSON structure:
${JSON.stringify(analytics)}`;

    const llmResponse = await callLlmProvider({ prompt, provider });

    try {
      // Clean and parse the response
      const cleanedResponse =
        typeof llmResponse === "string"
          ? llmResponse.replace(/([{,]\s*)(\w+)(:)/g, '$1"$2"$3')
          : llmResponse;

      return cleanedResponse
        ? JSON.parse(cleanedResponse)
        : {
            summary: "",
            peak_activity_times: "unknown",
            popular_actions: [],
            device_distribution: deviceDistribution,
            activity_trend: "unknown",
            recommendations: [],
          };
    } catch {
      return {
        summary: "Error processing store insights",
        peak_activity_times: "unknown",
        popular_actions: [],
        device_distribution: deviceDistribution,
        activity_trend: "unknown",
        recommendations: [],
      };
    }
  },
});
