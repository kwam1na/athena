import { useQuery } from "convex/react";
import { AlertTriangle, GitBranch, Signal } from "lucide-react";
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

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function StorefrontObservabilityPanel() {
  const { activeStore } = useGetActiveStore();

  const report = useQuery(
    api.storeFront.analytics.getStorefrontObservabilityReport,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  );

  if (!activeStore || report === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Storefront observability</CardTitle>
          <CardDescription>Loading the latest journey diagnostics.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((index) => (
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

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <Signal className="h-4 w-4" />
          <CardTitle className="text-lg">Storefront observability</CardTitle>
        </div>
        <CardDescription>
          Forward-looking journey progression and failure clusters from the
          canonical storefront observability contract.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryCard label="Observed events" value={report.summary.totalEvents} />
          <SummaryCard label="Failure events" value={report.summary.totalFailures} />
          <SummaryCard label="Correlated sessions" value={report.summary.uniqueSessions} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <h3 className="font-medium">Journey funnel progression</h3>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Journey</th>
                    <th className="px-4 py-3 font-medium">Step</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Events</th>
                    <th className="px-4 py-3 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {report.funnel.length > 0 ? (
                    report.funnel.map((entry) => (
                      <tr key={`${entry.journey}-${entry.step}-${entry.status}`} className="border-t">
                        <td className="px-4 py-3">{formatLabel(entry.journey)}</td>
                        <td className="px-4 py-3">{formatLabel(entry.step)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={entry.status === "failed" ? "destructive" : "secondary"}>
                            {formatLabel(entry.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">{entry.count}</td>
                        <td className="px-4 py-3">{entry.uniqueSessions}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                        No storefront observability events have been recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <h3 className="font-medium">Failure clusters</h3>
            </div>
            <div className="space-y-3">
              {report.failureClusters.length > 0 ? (
                report.failureClusters.map((cluster) => (
                  <div
                    key={cluster.errorCategory}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">
                            {formatLabel(cluster.errorCategory)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {cluster.count} events across {cluster.uniqueSessions} sessions
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
                      {cluster.sample.route && <p>Route: {cluster.sample.route}</p>}
                      {cluster.sample.errorCode && <p>Code: {cluster.sample.errorCode}</p>}
                      {cluster.sample.errorMessage && (
                        <p>Message: {cluster.sample.errorMessage}</p>
                      )}
                      <p>Sessions: {cluster.sessions.slice(0, 3).join(", ")}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No failure clusters yet. Failed storefront observability events
                  will appear here automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
