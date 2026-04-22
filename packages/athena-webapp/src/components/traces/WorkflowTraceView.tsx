import { useQuery } from "convex/react";
import type { Id } from "~/convex/_generated/dataModel";

import View from "../View";
import PageHeader from "../common/PageHeader";
import { FadeIn } from "../common/FadeIn";
import { Badge } from "../ui/badge";
import { NotFoundView } from "../states/not-found/NotFoundView";
import { api } from "~/convex/_generated/api";
import { capitalizeWords } from "~/src/lib/utils";

export type WorkflowTraceHeaderModel = {
  health: string;
  primaryLookupType: string;
  primaryLookupValue: string;
  status: string;
  summary?: string;
  title: string;
  traceId: string;
  workflowType: string;
};

export type WorkflowTraceEventModel = {
  kind: string;
  message?: string | null;
  occurredAt: number;
  sequence: number;
  source: string;
  status: string;
  step: string;
  traceId: string;
  workflowType: string;
};

export type WorkflowTraceViewModel = {
  events: WorkflowTraceEventModel[];
  header: WorkflowTraceHeaderModel;
};

function formatTraceLabel(value: string) {
  return capitalizeWords(value.replaceAll("_", " ").replaceAll("-", " "));
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getStatusTone(status: string) {
  switch (status.toLowerCase()) {
    case "healthy":
    case "succeeded":
    case "success":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "partial":
    case "warning":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "failed":
    case "error":
      return "border-red-300 bg-red-50 text-red-700";
    case "running":
    case "started":
      return "border-sky-300 bg-sky-50 text-sky-700";
    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}

export function WorkflowTraceHeader({
  header,
}: {
  header: WorkflowTraceHeaderModel;
}) {
  return (
    <PageHeader>
      <div className="flex w-full flex-wrap items-start justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Workflow trace
          </p>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {header.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {formatTraceLabel(header.workflowType)} · Trace {header.traceId}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className={getStatusTone(header.status)}>
              {formatTraceLabel(header.status)}
            </Badge>
            <Badge variant="outline" className={getStatusTone(header.health)}>
              {formatTraceLabel(header.health)}
            </Badge>
          </div>
        </div>

        <div className="max-w-xl space-y-1 text-right">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Primary lookup
          </p>
          <p className="text-sm font-medium">
            {formatTraceLabel(header.primaryLookupType)}
          </p>
          <p className="text-sm text-muted-foreground">
            {header.primaryLookupValue}
          </p>
        </div>
      </div>

      {header.summary ? (
        <div className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-6">
          {header.summary}
        </div>
      ) : null}
    </PageHeader>
  );
}

export function WorkflowTraceTimeline({
  events,
}: {
  events: WorkflowTraceEventModel[];
}) {
  const orderedEvents = [...events].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt - right.occurredAt;
    }

    return left.sequence - right.sequence;
  });

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <div className="space-y-1">
        <p className="text-sm font-medium">Timeline</p>
        <p className="text-sm text-muted-foreground">
          Ordered workflow events for this trace.
        </p>
      </div>

      <ol className="space-y-3">
        {orderedEvents.map((event) => (
          <li
            key={`${event.traceId}-${event.sequence}-${event.step}`}
            className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {formatTraceLabel(event.step)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={getStatusTone(event.status)}>
                    {formatTraceLabel(event.status)}
                  </Badge>
                  <Badge variant="outline">{formatTraceLabel(event.kind)}</Badge>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {formatTimestamp(event.occurredAt)}
              </p>
            </div>

            {event.message ? (
              <p className="mt-3 text-sm text-muted-foreground">{event.message}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkflowTraceView({
  storeId,
  traceId,
}: {
  storeId: Id<"store">;
  traceId: string;
}) {

  const workflowTrace = useQuery(
    api.workflowTraces.public.getWorkflowTraceViewById,
    {
      storeId,
      traceId,
    },
  );

  if (workflowTrace === undefined) {
    return (
      <View>
        <FadeIn>
          <div className="container mx-auto p-6">
            <p className="text-sm text-muted-foreground">
              Loading workflow trace...
            </p>
          </div>
        </FadeIn>
      </View>
    );
  }

  if (!workflowTrace) {
    return <NotFoundView entity="workflow trace" entityIdentifier={traceId} />;
  }

  return (
    <View header={<WorkflowTraceHeader header={workflowTrace.header} />}>
      <FadeIn>
        <WorkflowTraceTimeline events={workflowTrace.events} />
      </FadeIn>
    </View>
  );
}

export default WorkflowTraceView;
