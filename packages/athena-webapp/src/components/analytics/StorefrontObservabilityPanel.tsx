import { useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, GitBranch, Signal } from "lucide-react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Badge } from "../ui/badge";
import { getRelativeTime, snakeCaseToWords } from "~/src/lib/utils";

function formatLabel(value: string) {
  return snakeCaseToWords(value);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-layout-md py-layout-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}

function getTrafficSourceBadge(
  trafficSource: "customer" | "synthetic_monitor" | "mixed",
) {
  switch (trafficSource) {
    case "synthetic_monitor":
      return {
        label: "Synthetic monitor",
        variant: "secondary" as const,
      };
    case "mixed":
      return {
        label: "Mixed traffic",
        variant: "outline" as const,
      };
    default:
      return {
        label: "Customer traffic",
        variant: "outline" as const,
      };
  }
}

export default function StorefrontObservabilityPanel() {
  const { activeStore } = useGetActiveStore();

  const report = useQuery(
    api.storeFront.analytics.getStorefrontObservabilityReport,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  if (!activeStore || report === undefined) {
    return (
      <Card className="border-border bg-surface shadow-surface">
        <CardHeader>
          <CardTitle className="text-lg">Storefront health</CardTitle>
          <CardDescription>
            Loading the latest storefront signal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-lg bg-muted/50"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const visibleFunnel = report.funnel.slice(0, 5);
  const visibleFailureClusters = report.failureClusters.slice(0, 3);
  const hasFailures = report.summary.totalFailures > 0;

  return (
    <Card className="border-border bg-surface shadow-surface">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Signal className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-lg">Storefront health</CardTitle>
            </div>
            <CardDescription>
              Journey signal from recent customer and monitor events.
            </CardDescription>
          </div>
          <Badge variant={hasFailures ? "destructive" : "secondary"}>
            {hasFailures ? "Needs attention" : "No failures"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard
            label="Events"
            value={report.summary.totalEvents}
          />
          <SummaryCard
            label="Failures"
            value={report.summary.totalFailures}
          />
          <SummaryCard
            label="Sessions"
            value={report.summary.uniqueSessions}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium">Journey movement</h3>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Step</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">
                      Events
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFunnel.length > 0 ? (
                    visibleFunnel.map((entry) => (
                      <tr
                        key={`${entry.journey}-${entry.step}-${entry.status}`}
                        className="border-t"
                      >
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <p className="font-medium">
                              {formatLabel(entry.step)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatLabel(entry.journey)}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              entry.status === "failed"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {formatLabel(entry.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {entry.count}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-4 py-6 text-muted-foreground"
                        colSpan={3}
                      >
                        No storefront observability events have been recorded
                        yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {hasFailures ? (
                <AlertTriangle className="h-4 w-4 text-danger" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-success" />
              )}
              <h3 className="font-medium">Operator attention</h3>
            </div>
            <div className="space-y-3">
              {visibleFailureClusters.length > 0 ? (
                visibleFailureClusters.map((cluster) => {
                  const sourceBadge = getTrafficSourceBadge(
                    cluster.trafficSource,
                  );

                  return (
                    <div
                      key={cluster.errorCategory}
                      className="rounded-md border border-border bg-background px-layout-md py-layout-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">
                              {formatLabel(cluster.errorCategory)}
                            </Badge>
                            <Badge variant={sourceBadge.variant}>
                              {sourceBadge.label}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {cluster.count} events across{" "}
                              {cluster.uniqueSessions} sessions
                            </span>
                          </div>
                          <p className="text-sm">
                            {formatLabel(cluster.sample.journey)} /{" "}
                            {formatLabel(cluster.sample.step)}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Latest {getRelativeTime(cluster.latestEventTime)}
                        </p>
                      </div>

                      <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                        {cluster.sample.route && (
                          <p>Route: {cluster.sample.route}</p>
                        )}
                        {cluster.sample.errorCode && (
                          <p>Code: {cluster.sample.errorCode}</p>
                        )}
                        {cluster.sample.errorMessage && (
                          <p>Message: {cluster.sample.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-border bg-background px-layout-md py-layout-sm text-sm text-muted-foreground">
                  No storefront failures need operator attention.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
