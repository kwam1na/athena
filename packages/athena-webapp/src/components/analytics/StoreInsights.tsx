import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Clock,
  Laptop,
  Lightbulb,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  IntelligenceDebugView,
  ReadoutTrustMetadata,
  type IntelligenceRunDebug,
} from "../intelligence/ReadoutSupport";
import {
  isSharedDemoUiEnabled,
  useSharedDemoContext,
} from "@/hooks/useSharedDemoContext";

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

export default function StoreInsights({ storeId }: StoreInsightsProps) {
  const sharedDemoContext = useSharedDemoContext();
  const canUseIntelligence =
    !isSharedDemoUiEnabled || sharedDemoContext === null;
  const latestArtifact = useQuery(
    api.intelligence.runs.latestArtifactBySubject,
    canUseIntelligence
      ? {
          storeId,
          kind: "store_insights",
          subjectTable: "store",
          subjectId: String(storeId),
        }
      : "skip",
  );
  const runDebug = useQuery(
    api.intelligence.runs.latestRunDebug,
    canUseIntelligence
      ? {
          storeId,
          capability: "storeInsights",
          sourceRefTable: "store",
          sourceRefId: String(storeId),
        }
      : "skip",
  ) as IntelligenceRunDebug | null | undefined;
  const generateInsights = useAction(
    api.intelligence.capabilities.actions.generateStoreInsights,
  );
  const dismissArtifact = useMutation(api.intelligence.runs.dismissArtifact);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const artifactInsights = latestArtifact?.payload as StoreInsightsResult | undefined;
  const visibleInsights = artifactInsights ?? null;

  if (!canUseIntelligence) return null;

  const handleGenerate = async () => {
    setInsightsLoading(true);
    setGenerationError(null);
    try {
      const result = await generateInsights({ storeId });
      if (result.kind === "error") {
        setGenerationError(result.message);
      }
    } catch {
      setGenerationError(
        "Store readout could not be generated. Try again in a moment.",
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
      aria-label="Store insights"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-surface"
    >
      <div className="border-b border-border/70 bg-surface-raised px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-layout-xs">
            <div className="flex flex-wrap items-center gap-layout-xs">
              <Badge variant="outline" className="rounded-full">
                Store readout
              </Badge>
              {latestArtifact?.limitedEvidence ? (
                <Badge variant="outline" className="rounded-full">
                  Limited evidence
                </Badge>
              ) : null}
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Recommended next move
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                {visibleInsights?.summary ??
                  "Generate a storefront readout from current activity before deciding what needs attention."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-layout-xs">
            {latestArtifact?._id ? (
              <Button
                aria-label="Dismiss store readout"
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
              disabled={insightsLoading}
              onClick={handleGenerate}
              type="button"
              variant="outline"
            >
              {insightsLoading ? (
                <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
              )}
              {visibleInsights ? "Rerun readout" : "Generate readout"}
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
        <div className="grid gap-layout-lg px-layout-md py-layout-lg xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-layout-lg">
            <section className="space-y-layout-sm">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">
                  Recommendations
                </h3>
              </div>
              <ol className="grid gap-layout-sm">
                {visibleInsights.recommendations.map((recommendation, index) => (
                  <li
                    className="grid gap-layout-sm rounded-lg border border-border/80 bg-background px-layout-md py-layout-sm sm:grid-cols-[2rem_minmax(0,1fr)]"
                    key={`${recommendation}:${index}`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-raised font-numeric text-sm text-muted-foreground">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-6 text-foreground">
                      {recommendation}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid gap-layout-md md:grid-cols-2">
              <SignalPanel
                icon={<Clock aria-hidden="true" className="h-4 w-4" />}
                label="Peak activity"
                value={visibleInsights.peak_activity_times}
              />
              <SignalPanel
                icon={<TrendingUp aria-hidden="true" className="h-4 w-4" />}
                label="Activity trend"
                value={formatActivityTrend(visibleInsights.activity_trend)}
              />
            </div>
          </div>

          <aside className="space-y-layout-md">
            {latestArtifact ? (
              <ReadoutTrustMetadata artifact={latestArtifact} />
            ) : null}
            <DeviceDistribution distribution={visibleInsights.device_distribution} />
            <PopularActions actions={visibleInsights.popular_actions} />
          </aside>
        </div>
      ) : (
        <div className="grid gap-layout-lg px-layout-md py-layout-lg lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-h-40 flex-col justify-center rounded-lg border border-dashed border-border bg-background px-layout-md py-layout-lg">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="mt-layout-sm text-base font-medium text-foreground">
              No store readout yet
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Generate a readout when storefront activity changes or before reviewing
              customer and product detail.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background px-layout-md py-layout-md text-sm leading-6 text-muted-foreground">
            Athena will show the data window, confidence, and evidence count after a
            readout is generated.
          </div>
        </div>
      )}
      <IntelligenceDebugView
        debug={runDebug}
        emptyMessage="No intelligence run has been recorded for this store readout yet."
        expanded={debugExpanded}
        layout="grid"
        onToggle={() => setDebugExpanded((expanded) => !expanded)}
      />
    </section>
  );
}

function SignalPanel({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-border/80 bg-background px-layout-md py-layout-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <h3 className="text-xs font-medium uppercase tracking-[0.16em]">
          {label}
        </h3>
      </div>
      <p className="mt-layout-xs text-sm leading-6 text-foreground">{value}</p>
    </section>
  );
}

function DeviceDistribution({
  distribution,
}: {
  distribution: StoreInsightsResult["device_distribution"];
}) {
  const desktop = parsePercent(distribution.desktop);
  const mobile = parsePercent(distribution.mobile);
  const total = desktop + mobile;
  const desktopShare = total > 0 ? (desktop / total) * 100 : 50;

  return (
    <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
      <div className="flex items-center gap-2 text-muted-foreground">
        <MonitorSmartphone aria-hidden="true" className="h-4 w-4" />
        <h3 className="text-xs font-medium uppercase tracking-[0.16em]">
          Device split
        </h3>
      </div>
      <div className="mt-layout-sm h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${desktopShare}%` }}
        />
      </div>
      <div className="mt-layout-sm grid gap-layout-xs text-sm">
        <DeviceRow
          icon={<Laptop aria-hidden="true" className="h-4 w-4" />}
          label="Desktop"
          value={distribution.desktop}
        />
        <DeviceRow
          icon={<Smartphone aria-hidden="true" className="h-4 w-4" />}
          label="Mobile"
          value={distribution.mobile}
        />
      </div>
    </section>
  );
}

function DeviceRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-layout-sm">
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function PopularActions({ actions }: { actions: string[] }) {
  return (
    <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
      <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Popular actions
      </h3>
      <div className="mt-layout-sm flex flex-wrap gap-layout-xs">
        {actions.map((action) => (
          <Badge
            className="max-w-full truncate rounded-full"
            key={action}
            variant="outline"
          >
            {formatActionLabel(action)}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function formatActionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function formatActivityTrend(trend: string) {
  const normalized = trend.trim().toLowerCase();
  if (!normalized) return "Not enough activity yet";

  return normalized
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parsePercent(value: string) {
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
