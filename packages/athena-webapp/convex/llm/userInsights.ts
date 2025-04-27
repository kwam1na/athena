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

    const analytics = await ctx.runQuery(
      api.storeFront.user.getAllUserActivity,
      {
        id: args.storeFrontUserId,
      }
    );

    const prompt = `You are an analytics assistant analyzing user behavior. Given the user actions below, return ONLY a JSON object (no other text/markdown).

The response must be a valid JSON object with this exact structure:
{
  "summary": "Brief 1-2 sentence summary of user behavior",
  "engagement_level": "high|medium|low",
  "device_preference": "desktop|mobile|unknown",
  "likely_intent": "short phrase describing intent",
  "activity_status": "active|inactive|new",
  "recommendations": [
    "First actionable recommendation",
    "Second actionable recommendation",
    "Third actionable recommendation"
  ]
}

Activity status should be determined using the _creationTime timestamp (in milliseconds since epoch) on each action:
- "active": Has actions with _creationTime within the last 24 hours, or regular actions across multiple days
- "inactive": Most recent _creationTime is more than 7 days old
- "new": All actions have _creationTime within the last 24 hours AND earliest action is less than 24 hours old

Example valid response:
{
  "summary": "Frequent visitor showing high engagement across multiple product categories with clear purchase intent.",
  "engagement_level": "high",
  "device_preference": "mobile",
  "likely_intent": "ready to purchase",
  "activity_status": "active",
  "recommendations": [
    "Send personalized product recommendations",
    "Offer time-limited discount",
    "Show similar items in category"
  ]
}

Analyze these user actions and respond with a similar JSON structure:
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
            engagement_level: "unknown",
            device_preference: "unknown",
            likely_intent: "unknown",
            activity_status: "unknown",
            recommendations: [],
          };
    } catch {
      return {
        summary: "Error processing insights",
        engagement_level: "unknown",
        device_preference: "unknown",
        likely_intent: "unknown",
        activity_status: "unknown",
        recommendations: [],
      };
    }
  },
});

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

    const prompt = `You are an analytics assistant analyzing store-wide behavior patterns. Given the store's analytics data below, return ONLY a JSON object (no other text/markdown).

The response must be a valid JSON object with this exact structure:
{
  "summary": "Brief 2-3 sentence summary of store activity patterns",
  "peak_activity_times": "description of when most activity occurs",
  "popular_actions": ["array of top 3 most common user actions"],
  "device_distribution": {
    "desktop": "percentage (e.g. 60%)",
    "mobile": "percentage (e.g. 40%)",
    "unknown": "percentage (e.g. 0%)"
  },
  "activity_trend": "increasing|steady|decreasing",
  "recommendations": [
    "First actionable recommendation for store improvement",
    "Second actionable recommendation for store improvement",
    "Third actionable recommendation for store improvement"
  ]
}

Activity trend should be determined using the _creationTime timestamp (in milliseconds since epoch):
- "increasing": More actions in recent days compared to previous period
- "steady": Consistent number of actions over time
- "decreasing": Fewer actions in recent days compared to previous period

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
            device_distribution: {
              desktop: "0%",
              mobile: "0%",
              unknown: "100%",
            },
            activity_trend: "unknown",
            recommendations: [],
          };
    } catch {
      return {
        summary: "Error processing store insights",
        peak_activity_times: "unknown",
        popular_actions: [],
        device_distribution: {
          desktop: "0%",
          mobile: "0%",
          unknown: "100%",
        },
        activity_trend: "unknown",
        recommendations: [],
      };
    }
  },
});
