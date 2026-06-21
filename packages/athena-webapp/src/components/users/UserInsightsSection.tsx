import { useParams } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  HelpCircle,
  Smartphone,
  Monitor,
  WandSparkles,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { capitalizeFirstLetter } from "~/src/lib/utils";
import { Button } from "../ui/button";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";

// EngagementBar helper component
const EngagementBar = ({ level }: { level: string }) => {
  const count = level === "high" ? 3 : level === "medium" ? 2 : 1;
  let color = "bg-green-600";
  const barHeight = ["h-2.5", "h-5", "h-7"]; // low, medium, high
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

type UserInsightsResult = {
  device_preference?: string;
  engagement_level?: string;
  likely_intent?: string;
  recommendations?: string[];
  summary?: string;
};

type IntelligenceArtifactSummary = {
  status: string;
  createdAt: number;
  dataWindowStartAt?: number;
  dataWindowEndAt?: number;
  confidence?: number;
  evidenceRefs?: unknown[];
  limitedEvidence?: boolean;
  payload?: {
    rationale?: unknown;
  };
};

// UserInsightsSection component
export const UserInsightsSection = () => {
  const generateUserInsights = useAction(
    api.intelligence.capabilities.actions.generateUserInsights,
  );
  const dismissArtifact = useMutation(api.intelligence.runs.dismissArtifact);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const { activeStore } = useGetActiveStore();

  const { userId } = useParams({ strict: false });
  const latestArtifact = useQuery(
    api.intelligence.runs.latestArtifactBySubject,
    userId && activeStore?._id
      ? {
          storeId: activeStore._id,
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: String(userId),
        }
      : "skip",
  );
  const artifactInsights = latestArtifact?.payload as UserInsightsResult | undefined;
  const visibleInsights = artifactInsights ?? null;

  const handleGenerate = async () => {
    if (!userId || !activeStore?._id) return;
    setInsightsLoading(true);
    setGenerationError(null);
    try {
      const result = await generateUserInsights({
        storeId: activeStore._id,
        storeFrontUserId: userId as Id<"storeFrontUser"> | Id<"guest">,
      });
      if (result.kind === "error") {
        setGenerationError(result.message);
      }
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!latestArtifact?._id) return;
    await dismissArtifact({ artifactId: latestArtifact._id });
  };

  return (
    <div className={`space-y-8 p-8 border rounded-lg`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">User Insights</p>
          <WandSparkles className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          {latestArtifact?._id ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              aria-label="Dismiss user insights"
            >
              <X className="w-4 h-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={!userId || !activeStore?._id || insightsLoading}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {visibleInsights ? "Rerun" : "Generate"}
          </Button>
        </div>
      </div>
      {latestArtifact ? (
        <TrustMetadata artifact={latestArtifact} />
      ) : null}
      {generationError ? (
        <p className="text-sm text-muted-foreground">{generationError}</p>
      ) : null}
      {insightsLoading ? null : visibleInsights ? (
        <div className="space-y-8">
          {/* Summary */}
          {visibleInsights.summary && (
            <div>
              <p className="font-medium text-sm mb-2">Summary</p>
              <p className="text-sm">{visibleInsights.summary}</p>
            </div>
          )}
          <hr />
          {/* Profile */}
          <div className="space-y-8">
            <p className="font-medium text-sm mb-2">Profile</p>
            <ul className="list-disc ml-6 text-sm space-y-8">
              {visibleInsights.likely_intent && (
                <li>
                  <span className="font-bold">Likely Intent:</span>{" "}
                  {visibleInsights.likely_intent}
                </li>
              )}
            </ul>
            <div className="flex items-end gap-12 mt-4">
              {visibleInsights.engagement_level && (
                <div className="flex flex-col items-center">
                  <EngagementBar
                    level={visibleInsights.engagement_level.toLowerCase()}
                  />
                  <span className="text-sm mt-2">
                    {`${capitalizeFirstLetter(visibleInsights.engagement_level)} engagement`}
                  </span>
                </div>
              )}
              {visibleInsights.device_preference && (
                <div className="flex flex-col items-center">
                  {visibleInsights.device_preference === "desktop" ? (
                    <Monitor className="w-5 h-5 text-muted-foreground" />
                  ) : visibleInsights.device_preference === "mobile" ? (
                    <Smartphone className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <HelpCircle className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-sm mt-2">
                    {capitalizeFirstLetter(visibleInsights.device_preference)}
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
          {visibleInsights.recommendations &&
            Array.isArray(visibleInsights.recommendations) && (
              <div className="text-sm">
                <p className="font-medium mb-2">Recommendations</p>
                <ul className="list-disc ml-6 space-y-1">
                  {visibleInsights.recommendations.map((rec: string, i: number) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Generate an Athena readout from this customer&apos;s activity.
        </p>
      )}
    </div>
  );
};

function TrustMetadata({ artifact }: { artifact: IntelligenceArtifactSummary }) {
  const dataWindow =
    artifact.dataWindowStartAt && artifact.dataWindowEndAt
      ? `${new Date(artifact.dataWindowStartAt).toLocaleDateString()} - ${new Date(
          artifact.dataWindowEndAt,
        ).toLocaleDateString()}`
      : "No data window";
  const confidence =
    typeof artifact.confidence === "number"
      ? `${Math.round(artifact.confidence * 100)}% confidence`
      : "Confidence unavailable";

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {artifact.status} · Generated {new Date(artifact.createdAt).toLocaleString()} ·{" "}
        {dataWindow}
      </p>
      <p>
        {confidence} · {artifact.evidenceRefs?.length ?? 0} evidence refs
        {artifact.limitedEvidence ? " · Limited evidence" : ""}
      </p>
      {typeof artifact.payload?.rationale === "string" ? (
        <p>{artifact.payload.rationale}</p>
      ) : null}
    </div>
  );
}
