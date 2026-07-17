import { useQuery } from "convex/react";
import { Circle } from "lucide-react";
import type { Id } from "~/convex/_generated/dataModel";

import View from "../View";
import { ComposedPageHeader } from "../common/PageHeader";
import { FadeIn } from "../common/FadeIn";
import {
  RegisterSessionIdentity,
  type RegisterSessionIdentityModel,
} from "../common/RegisterSessionIdentity";
import { NotFoundView } from "../states/not-found/NotFoundView";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { api } from "~/convex/_generated/api";
import { capitalizeWords, getRelativeTime } from "~/src/lib/utils";
import { useGetTerminal } from "@/hooks/useGetTerminal";

export type WorkflowTraceHeaderModel = {
  health: string;
  primaryLookupType: string;
  primaryLookupValue: string;
  registerSession?: RegisterSessionIdentityModel | null;
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

function formatTraceTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function RelativeTraceTimestamp({ timestamp }: { timestamp: number }) {
  const relativeTimestamp = getRelativeTime(timestamp);
  const fullTimestamp = formatTraceTimestamp(timestamp);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">{relativeTimestamp}</span>
        </TooltipTrigger>
        <TooltipContent className="px-2 py-1 text-xs">
          {fullTimestamp}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkflowTraceHeader({
  header,
}: {
  header: WorkflowTraceHeaderModel;
}) {
  return (
    <ComposedPageHeader
      className="h-auto min-h-16 items-start gap-3 border-b border-border px-4 py-3 sm:items-center sm:border-0 sm:py-4"
      leadingContent={
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {header.registerSession ? (
            <RegisterSessionIdentity registerSession={header.registerSession} />
          ) : (
            <h1 className="min-w-0 truncate text-base font-semibold leading-5 text-foreground sm:text-sm">
              {header.title}
            </h1>
          )}
          <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
            / History
          </span>
        </div>
      }
    />
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
                <RelativeTraceTimestamp timestamp={event.occurredAt} />
                {` · ${formatTraceLabel(event.status)} · ${formatTraceLabel(event.kind)}`}
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
  const terminal = useGetTerminal();
  const workflowTrace = useQuery(
    api.workflowTraces.public.getWorkflowTraceViewById,
    {
      storeId,
      terminalId: terminal?._id,
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
      <FadeIn>
        <WorkflowTraceTimeline events={workflowTrace.events} />
      </FadeIn>
    </View>
  );
}

export default WorkflowTraceView;
