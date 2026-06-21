import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Laptop,
  Smartphone,
  Lightbulb,
  TrendingUp,
  RefreshCw,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";

interface StoreInsightsProps {
  storeId: Id<"store">;
}

type StoreInsightsResult = {
  activity_trend: string;
  device_distribution: {
    desktop: string;
    mobile: string;
    unknown?: string;
  };
  peak_activity_times: string;
  popular_actions: string[];
  recommendations: string[];
  summary: string;
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

export default function StoreInsights({ storeId }: StoreInsightsProps) {
  const latestArtifact = useQuery(
    api.intelligence.runs.latestArtifactBySubject,
    {
      storeId,
      kind: "store_insights",
      subjectTable: "store",
      subjectId: String(storeId),
    },
  );
  const generateInsights = useAction(
    api.intelligence.capabilities.actions.generateStoreInsights,
  );
  const dismissArtifact = useMutation(api.intelligence.runs.dismissArtifact);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const artifactInsights = latestArtifact?.payload as StoreInsightsResult | undefined;
  const visibleInsights = artifactInsights ?? null;

  const getTrendIcon = () => {
    switch (visibleInsights?.activity_trend) {
      case "increasing":
        return <ArrowUp className="w-4 h-4 text-green-500" />;
      case "decreasing":
        return <ArrowDown className="w-4 h-4 text-red-500" />;
      default:
        return <ArrowRight className="w-4 h-4" />;
    }
  };

  const handleGenerate = async () => {
    setInsightsLoading(true);
    setGenerationError(null);
    try {
      const result = await generateInsights({ storeId });
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
    <Card className="space-y-4">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" />
            Store Insights
          </CardTitle>
          <div className="flex items-center gap-2">
            {latestArtifact?._id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                aria-label="Dismiss store insights"
              >
                <X className="w-4 h-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={insightsLoading}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {visibleInsights ? "Rerun" : "Generate"}
            </Button>
          </div>
        </div>
        <CardDescription className="max-w-3xl leading-relaxed">
          {visibleInsights?.summary ??
            "Generate a current Athena readout from store activity."}
        </CardDescription>
        {generationError ? (
          <p className="text-sm text-muted-foreground">{generationError}</p>
        ) : null}
        {latestArtifact ? (
          <TrustMetadata artifact={latestArtifact} />
        ) : null}
      </CardHeader>
      {visibleInsights ? (
      <CardContent className="space-y-8">
        {/* Activity Trend and Peak Times */}
        <div className="space-y-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {getTrendIcon()}
              Activity Trend
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4" />
              Peak Activity
            </div>
            <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
              {visibleInsights.peak_activity_times}
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Device Distribution */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Device Distribution</h3>
            <div className="flex gap-8">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {visibleInsights.device_distribution.desktop}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">
                  {visibleInsights.device_distribution.mobile}
                </span>
              </div>
            </div>
          </div>

          {/* Popular Actions */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Popular Actions</h3>
            <ul className="space-y-2">
              {visibleInsights.popular_actions.map((action: string, index: number) => (
                <li key={index} className="text-sm text-muted-foreground">
                  {action}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Recommendations */}
        <div className="space-y-8">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Recommendations
          </h3>
          <ul className="grid grid-cols-1 gap-4">
            {visibleInsights.recommendations.map((rec: string, index: number) => (
              <li
                key={index}
                className="text-sm text-muted-foreground max-w-md leading-relaxed"
              >
                {rec}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      ) : null}
    </Card>
  );
}

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
