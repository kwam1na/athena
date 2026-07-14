import { useParams } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Brain,
  HelpCircle,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  Sparkles,
  Target,
  UserRoundSearch,
  WandSparkles,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { capitalizeFirstLetter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import {
  isSharedDemoUiEnabled,
  useSharedDemoContext,
} from "~/src/hooks/useSharedDemoContext";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  IntelligenceDebugView,
  ReadoutTrustMetadata,
  type IntelligenceRunDebug,
} from "../intelligence/ReadoutSupport";

type UserInsightsResult = {
  activity_status?: string;
  device_preference?: string;
  engagement_level?: string;
  likely_intent?: string;
  recommendations?: string[];
  summary?: string;
};

export const UserInsightsSection = () => {
  const generateUserInsights = useAction(
    api.intelligence.capabilities.actions.generateUserInsights,
  );
  const dismissArtifact = useMutation(api.intelligence.runs.dismissArtifact);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const { activeStore } = useGetActiveStore();
  const sharedDemoContext = useSharedDemoContext();
  const canUseIntelligence =
    !isSharedDemoUiEnabled || sharedDemoContext === null;
  const { userId } = useParams({ strict: false });

  const latestArtifact = useQuery(
    api.intelligence.runs.latestArtifactBySubject,
    canUseIntelligence && userId && activeStore?._id
      ? {
          storeId: activeStore._id,
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: String(userId),
        }
      : "skip",
  );
  const runDebug = useQuery(
    api.intelligence.runs.latestRunDebug,
    canUseIntelligence && userId && activeStore?._id
      ? {
          storeId: activeStore._id,
          capability: "userInsights",
          sourceRefTable: "storeFrontActor",
          sourceRefId: String(userId),
        }
      : "skip",
  ) as IntelligenceRunDebug | null | undefined;
  const artifactInsights = latestArtifact?.payload as UserInsightsResult | undefined;
  const visibleInsights = artifactInsights ?? null;

  if (!canUseIntelligence) return null;

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
    } catch {
      setGenerationError(
        "Customer readout could not be generated. Try again in a moment.",
      );
    } finally {
      setInsightsLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!latestArtifact?._id) return;
    await dismissArtifact({ artifactId: latestArtifact._id });
  };

  return (
    <section
      aria-label="Customer insights"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-surface"
    >
      <div className="border-b border-border/70 bg-surface-raised px-layout-md py-layout-md">
        <div className="flex items-start justify-between gap-layout-md">
          <div className="min-w-0 space-y-layout-xs">
            <div className="flex flex-wrap items-center gap-layout-xs">
              <Badge variant="outline" className="rounded-full">
                Customer readout
              </Badge>
              {latestArtifact?.limitedEvidence ? (
                <Badge variant="outline" className="rounded-full">
                  Limited evidence
                </Badge>
              ) : null}
            </div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Customer next move
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {visibleInsights?.summary ??
                "Generate a customer readout from this shopper's current activity and journey history."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-layout-xs">
            {latestArtifact?._id ? (
              <Button
                aria-label="Dismiss customer readout"
                className="h-9 w-9"
                onClick={handleDismiss}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              disabled={!userId || !activeStore?._id || insightsLoading}
              onClick={handleGenerate}
              size="sm"
              type="button"
              variant="outline"
            >
              {insightsLoading ? (
                <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              )}
              {visibleInsights ? "Rerun" : "Generate"}
            </Button>
          </div>
        </div>
        {generationError ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            {generationError}
          </p>
        ) : null}
      </div>

      {visibleInsights ? (
        <div className="space-y-layout-md px-layout-md py-layout-md">
          <div className="grid gap-layout-sm sm:grid-cols-3">
            <SignalTile
              icon={<Brain aria-hidden="true" className="h-4 w-4" />}
              label="Engagement"
              value={formatInsightValue(visibleInsights.engagement_level)}
            />
            <SignalTile
              icon={getDeviceIcon(visibleInsights.device_preference)}
              label="Device"
              value={formatInsightValue(visibleInsights.device_preference)}
            />
            <SignalTile
              icon={<UserRoundSearch aria-hidden="true" className="h-4 w-4" />}
              label="Activity"
              value={formatInsightValue(visibleInsights.activity_status)}
            />
          </div>

          <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Target aria-hidden="true" className="h-4 w-4" />
              <h3 className="text-xs font-medium uppercase tracking-[0.16em]">
                Likely intent
              </h3>
            </div>
            <p className="mt-layout-sm text-sm leading-6 text-foreground">
              {visibleInsights.likely_intent || "Intent unavailable"}
            </p>
          </section>

          <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
            <div className="flex items-center gap-2 text-muted-foreground">
              <WandSparkles aria-hidden="true" className="h-4 w-4" />
              <h3 className="text-xs font-medium uppercase tracking-[0.16em]">
                Recommended actions
              </h3>
            </div>
            <ol className="mt-layout-sm space-y-layout-sm">
              {(visibleInsights.recommendations ?? []).map((recommendation, index) => (
                <li
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2"
                  key={`${recommendation}:${index}`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-raised font-numeric text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-foreground">
                    {recommendation}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {latestArtifact ? (
            <ReadoutTrustMetadata artifact={latestArtifact} compact />
          ) : null}
        </div>
      ) : (
        <div className="px-layout-md py-layout-md">
          <div className="rounded-lg border border-dashed border-border bg-background px-layout-md py-layout-lg">
            <Sparkles className="h-5 w-5 text-action-workflow" />
            <h3 className="mt-layout-sm text-sm font-medium text-foreground">
              No customer readout yet
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Generate a readout before reviewing outreach, recovery, or order follow-up.
            </p>
          </div>
        </div>
      )}

      <IntelligenceDebugView
        debug={runDebug}
        emptyMessage="No intelligence run has been recorded for this customer readout yet."
        expanded={debugExpanded}
        onToggle={() => setDebugExpanded((expanded) => !expanded)}
      />
    </section>
  );
};

function SignalTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-background px-layout-sm py-layout-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <h3 className="text-xs font-medium uppercase tracking-[0.16em]">{label}</h3>
      </div>
      <p className="mt-layout-xs text-sm font-medium text-foreground">{value}</p>
    </section>
  );
}

function getDeviceIcon(device?: string) {
  if (device === "desktop") return <Monitor aria-hidden="true" className="h-4 w-4" />;
  if (device === "mobile") return <Smartphone aria-hidden="true" className="h-4 w-4" />;

  return <HelpCircle aria-hidden="true" className="h-4 w-4" />;
}

function formatInsightValue(value?: string) {
  if (!value) return "Unknown";

  return value
    .split(/[\s_-]+/)
    .map((part) => capitalizeFirstLetter(part))
    .join(" ");
}
