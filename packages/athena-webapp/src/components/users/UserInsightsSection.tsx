import { useParams } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
  HelpCircle,
  Smartphone,
  Monitor,
  WandSparkles,
  CircleDot,
  Circle,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { capitalizeFirstLetter } from "~/src/lib/utils";

// EngagementBar helper component
const EngagementBar = ({ level }: { level: string }) => {
  const count = level === "high" ? 3 : level === "medium" ? 2 : 1;
  let color = "bg-green-600";
  let barHeight = ["h-2.5", "h-5", "h-7"]; // low, medium, high
  if (level === "medium") color = "bg-yellow-400";
  if (level === "low") color = "bg-red-500";
  return (
    <span className="inline-flex items-end ml-2">
      {[...Array(3)].map((_, i) => (
        <span
          key={i}
          className={`inline-block w-4 mx-0.5 rounded ${barHeight[i]} ${
            i < count ? color : "bg-muted"
          }`}
        />
      ))}
    </span>
  );
};

// UserInsightsSection component
export const UserInsightsSection = () => {
  const userInsights = useAction(api.llm.userInsights.getUserInsightsFromLlm);
  const [insights, setInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const { userId } = useParams({ strict: false });

  useEffect(() => {
    if (userId) {
      setInsightsLoading(true);
      userInsights({
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      }).then((res) => {
        setInsights(res);
        setInsightsLoading(false);
      });
    }
  }, [userId]);

  // console.log(insights);

  return (
    <div className={`space-y-8 w-[80%]`}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">User Insights</p>
        <WandSparkles className="w-4 h-4 text-muted-foreground" />
      </div>
      {insightsLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-4 bg-muted rounded w-1/4" />
          <div className="h-4 bg-muted rounded w-2/3" />
        </div>
      ) : insights ? (
        <div className="space-y-8">
          {/* Summary */}
          {insights.summary && (
            <div>
              <p className="font-medium text-sm mb-2">Summary</p>
              <p className="text-sm">{insights.summary}</p>
            </div>
          )}
          <hr />
          {/* Profile */}
          <div className="space-y-8">
            <p className="font-medium text-sm mb-2">Profile</p>
            <ul className="list-disc ml-6 text-sm space-y-8">
              {insights.likely_intent && (
                <li>
                  <span className="font-bold">Likely Intent:</span>{" "}
                  {insights.likely_intent}
                </li>
              )}
            </ul>
            <div className="flex items-end gap-12 mt-4">
              {insights.engagement_level && (
                <div className="flex flex-col items-center">
                  <EngagementBar
                    level={insights.engagement_level.toLowerCase()}
                  />
                  <span className="text-sm mt-2">
                    {`${capitalizeFirstLetter(insights.engagement_level)} engagement`}
                  </span>
                </div>
              )}
              {insights.device_preference && (
                <div className="flex flex-col items-center">
                  {insights.device_preference === "desktop" ? (
                    <Monitor className="w-5 h-5 text-muted-foreground" />
                  ) : insights.device_preference === "mobile" ? (
                    <Smartphone className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <HelpCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-sm mt-2">
                    {capitalizeFirstLetter(insights.device_preference)}
                  </span>
                </div>
              )}
              {/* {insights.activity_status && (
                <div className="flex flex-col items-center">
                  {insights.activity_status === "active" ? (
                    <CircleDot className="w-5 h-5 text-green-500" />
                  ) : insights.activity_status === "inactive" ? (
                    <Circle className="w-5 h-5 text-gray-400" />
                  ) : insights.activity_status === "new" ? (
                    <Star className="w-5 h-5 text-yellow-400" />
                  ) : (
                    <HelpCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-sm mt-2">
                    {capitalizeFirstLetter(insights.activity_status)}
                  </span>
                </div>
              )} */}
            </div>
          </div>
          <hr />
          {/* Recommendations */}
          {insights.recommendations &&
            Array.isArray(insights.recommendations) && (
              <div className="text-sm">
                <p className="font-medium mb-2">Recommendations</p>
                <ul className="list-disc ml-6 space-y-1">
                  {insights.recommendations.map((rec: string, i: number) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      ) : (
        <p className="text-muted-foreground">No insights available.</p>
      )}
    </div>
  );
};
