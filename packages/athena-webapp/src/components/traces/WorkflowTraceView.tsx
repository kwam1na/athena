import { useQuery } from "convex/react";
import { Circle } from "lucide-react";
import type { Id } from "~/convex/_generated/dataModel";

import View from "../View";
import PageHeader, { NavigateBackButton } from "../common/PageHeader";
import { FadeIn } from "../common/FadeIn";
import { Badge } from "../ui/badge";
import { NotFoundView } from "../states/not-found/NotFoundView";
import { api } from "~/convex/_generated/api";
import { capitalizeWords, getRelativeTime } from "~/src/lib/utils";

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
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <NavigateBackButton />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {header.summary && <p className="text-sm">{header.summary}</p>}
              <Badge variant="outline" className={getStatusTone(header.status)}>
                {formatTraceLabel(header.status)}
              </Badge>
              <Badge variant="outline" className={getStatusTone(header.health)}>
                {formatTraceLabel(header.health)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="max-w-xl flex items-center gap-4 text-right">
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
    <section className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-sm font-medium">Timeline</p>
      </div>

      <ol className="space-y-8">
        {orderedEvents.map((event) => (
          <li
            key={`${event.traceId}-${event.sequence}-${event.step}`}
            className="flex items-center"
          >
            <div className="space-y-2">
              <div className="flex items-center">
                <Circle className="h-2 w-2 mt-1 mr-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {event.message || formatTraceLabel(event.step)}
                </p>
              </div>
              <p className="text-xs ml-4 text-muted-foreground">
                {`${getRelativeTime(event.occurredAt)} · ${formatTraceLabel(event.status)} · ${formatTraceLabel(event.kind)}`}
              </p>
            </div>
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
    return null;
  }

  if (!workflowTrace) {
    return <NotFoundView entity="workflow trace" entityIdentifier={traceId} />;
  }

  return (
    <View header={<WorkflowTraceHeader header={workflowTrace.header} />}>
      <FadeIn className="space-y-8">
        <WorkflowTraceTimeline events={workflowTrace.events} />
      </FadeIn>
    </View>
  );
}

export default WorkflowTraceView;
