import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, CircleAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { formatTerminalTimestamp } from "./terminalHealthPresentation";

type PosClientErrorQueryEvent = FunctionReturnType<
  typeof api.pos.public.telemetry.listClientEvents
>[number];
type RequiredQueryFields<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};
type OptionalQueryFields<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
};
export type PosClientErrorEvent =
  RequiredQueryFields<PosClientErrorQueryEvent> &
    OptionalQueryFields<PosClientErrorQueryEvent>;

type LevelFilter = "error" | "warn";

const LEVEL_FILTERS: Array<{ label: string; value: LevelFilter }> = [
  { label: "Errors", value: "error" },
  { label: "Warnings", value: "warn" },
];

const LIST_LIMIT = 50;

/**
 * "Client errors" metric tile for the terminal-health metrics row. The full
 * list and per-event detail live in a sheet so the surfacing stays visible
 * regardless of how many terminal cards the roster renders.
 */
export function PosClientErrorsMetricTile({
  storeId,
  terminalId,
  railHealth = "healthy",
}: {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  railHealth?: DiagnosticRailHealth;
}) {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("error");
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <PosClientDiagnosticsQueryBoundary
      fallback={
        <PosClientErrorsMetricTileContent
          events={[]}
          isLoading={false}
          levelFilter={levelFilter}
          onLevelFilterChange={setLevelFilter}
          controlledSheetOpen={isSheetOpen}
          onControlledSheetOpenChange={setIsSheetOpen}
          queryUnavailable
          railHealth={railHealth}
        />
      }
      key={levelFilter}
    >
      <PosClientErrorsMetricTileQuery
        levelFilter={levelFilter}
        onLevelFilterChange={setLevelFilter}
        controlledSheetOpen={isSheetOpen}
        onControlledSheetOpenChange={setIsSheetOpen}
        railHealth={railHealth}
        storeId={storeId}
        terminalId={terminalId}
      />
    </PosClientDiagnosticsQueryBoundary>
  );
}

function PosClientErrorsMetricTileQuery({
  storeId,
  terminalId,
  levelFilter,
  onLevelFilterChange,
  controlledSheetOpen,
  onControlledSheetOpenChange,
  railHealth,
}: {
  storeId: Id<"store">;
  terminalId?: Id<"posTerminal">;
  levelFilter: LevelFilter;
  onLevelFilterChange: (filter: LevelFilter) => void;
  controlledSheetOpen: boolean;
  onControlledSheetOpenChange: (open: boolean) => void;
  railHealth: DiagnosticRailHealth;
}) {
  const events = useQuery(api.pos.public.telemetry.listClientEvents, {
    storeId,
    ...(terminalId ? { terminalId } : {}),
    level: levelFilter,
    limit: LIST_LIMIT,
  });

  return (
    <PosClientErrorsMetricTileContent
      events={events ?? []}
      isLoading={events === undefined}
      levelFilter={levelFilter}
      onLevelFilterChange={onLevelFilterChange}
      controlledSheetOpen={controlledSheetOpen}
      onControlledSheetOpenChange={onControlledSheetOpenChange}
      railHealth={railHealth}
    />
  );
}

class PosClientDiagnosticsQueryBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PosClientErrorsMetricTileContent({
  events,
  isLoading,
  levelFilter,
  onLevelFilterChange,
  queryUnavailable = false,
  railHealth = "healthy",
  controlledSheetOpen,
  onControlledSheetOpenChange,
}: {
  events: PosClientErrorEvent[];
  isLoading: boolean;
  levelFilter: LevelFilter;
  onLevelFilterChange: (filter: LevelFilter) => void;
  queryUnavailable?: boolean;
  railHealth?: DiagnosticRailHealth;
  controlledSheetOpen?: boolean;
  onControlledSheetOpenChange?: (open: boolean) => void;
}) {
  const [internalSheetOpen, setInternalSheetOpen] = useState(false);
  const isSheetOpen = controlledSheetOpen ?? internalSheetOpen;
  const setIsSheetOpen = onControlledSheetOpenChange ?? setInternalSheetOpen;
  const [selectedEvent, setSelectedEvent] =
    useState<PosClientErrorEvent | null>(null);
  const returnFocusEventId = useRef<string | null>(null);

  useEffect(() => {
    if (selectedEvent || !returnFocusEventId.current) return;
    const eventId = returnFocusEventId.current;
    returnFocusEventId.current = null;
    document
      .querySelector<HTMLButtonElement>(
        `[data-client-event-id="${CSS.escape(eventId)}"]`,
      )
      ?.focus();
  }, [selectedEvent]);
  const countValue =
    events.length >= LIST_LIMIT ? `${LIST_LIMIT}+` : events.length;
  const hasErrors = !isLoading && events.length > 0;

  const closeSheet = () => {
    setIsSheetOpen(false);
    setSelectedEvent(null);
  };

  return (
    <>
      <button
        aria-label="Open client errors"
        className={cn(
          "rounded-lg border px-layout-md py-layout-sm text-left shadow-surface transition-colors",
          hasErrors
            ? "border-danger/30 bg-danger/5 hover:bg-danger/10"
            : "border-border bg-surface-raised hover:bg-muted/40",
        )}
        onClick={() => setIsSheetOpen(true)}
        type="button"
      >
        <p
          className={cn(
            "text-xs font-medium uppercase",
            hasErrors ? "text-danger" : "text-muted-foreground",
          )}
        >
          Client errors
        </p>
        {/* No loading indicator: the count renders 0 immediately and updates
            in place when the query resolves, so nothing swaps or shifts. */}
        <p className="mt-2 font-numeric text-2xl font-semibold tabular-nums">
          {countValue}
        </p>
      </button>

      <Sheet
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
        open={isSheetOpen}
      >
        <SheetContent
          className="flex w-[min(100vw,36rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-app-canvas p-0 shadow-overlay sm:max-w-xl"
          side="right"
        >
          <SheetHeader className="border-b border-border px-layout-lg py-layout-md">
            <div className="flex items-center gap-layout-sm">
              {selectedEvent ? (
                <Button
                  aria-label="Back to client errors"
                  onClick={() => {
                    returnFocusEventId.current = selectedEvent.clientEventId;
                    setSelectedEvent(null);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                </Button>
              ) : null}
              <SheetTitle>
                {selectedEvent ? "Client error detail" : "Client errors"}
              </SheetTitle>
            </div>
          </SheetHeader>

          {selectedEvent ? (
            <ClientErrorDetail event={selectedEvent} />
          ) : (
            <ClientErrorList
              events={events}
              isLoading={isLoading}
              levelFilter={levelFilter}
              onLevelFilterChange={onLevelFilterChange}
              onSelect={setSelectedEvent}
              queryUnavailable={queryUnavailable}
              railHealth={railHealth}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ClientErrorList({
  events,
  isLoading,
  levelFilter,
  onLevelFilterChange,
  onSelect,
  queryUnavailable,
  railHealth,
}: {
  events: PosClientErrorEvent[];
  isLoading: boolean;
  levelFilter: LevelFilter;
  onLevelFilterChange: (filter: LevelFilter) => void;
  onSelect: (event: PosClientErrorEvent) => void;
  queryUnavailable: boolean;
  railHealth: DiagnosticRailHealth;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-layout-md overflow-y-auto p-layout-lg">
      <div className="space-y-layout-xs">
        <p className="text-sm text-muted-foreground">
          Errors and warnings reported by terminals, including ones captured
          while offline.
        </p>
        <div
          aria-label="Filter client errors by level"
          className="flex gap-layout-2xs"
          role="group"
        >
          {LEVEL_FILTERS.map((filter) => (
            <Button
              aria-pressed={levelFilter === filter.value}
              key={filter.value}
              onClick={() => onLevelFilterChange(filter.value)}
              size="sm"
              variant={levelFilter === filter.value ? "secondary" : "ghost"}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        {railHealth === "degraded" ? (
          <p className="text-sm text-warning">
            Diagnostic delivery is degraded on this terminal. Recent events may
            be incomplete.
          </p>
        ) : railHealth === "pending" ? (
          <p className="text-sm text-warning">
            Diagnostic delivery is waiting for terminal setup to finish.
          </p>
        ) : railHealth === "not_reported" ? (
          <p className="text-sm text-muted-foreground">
            Diagnostic delivery has not been reported by this terminal yet.
          </p>
        ) : null}
      </div>

      {queryUnavailable ? (
        <div
          className="rounded-lg border border-danger/30 bg-danger/5 px-layout-lg py-layout-lg text-sm text-danger"
          role="alert"
        >
          Client diagnostics are not available right now. Try again shortly.
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading client errors…
        </p>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/25 px-layout-lg py-layout-lg text-sm text-muted-foreground">
          {levelFilter === "error"
            ? "No client errors reported"
            : "No client warnings reported"}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {events.map((event) => (
            <li key={event.clientEventId}>
              <button
                className="flex w-full flex-wrap items-center gap-layout-sm px-layout-md py-layout-sm text-left hover:bg-muted/40"
                data-client-event-id={event.clientEventId}
                onClick={() => onSelect(event)}
                type="button"
              >
                <ClientErrorLevelBadge level={event.level} />
                <Badge
                  className="border-border bg-muted text-muted-foreground"
                  variant="outline"
                >
                  {event.flow}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {event.message}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatTerminalTimestamp(event.occurredAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientErrorDetail({ event }: { event: PosClientErrorEvent }) {
  const source = event.source
    ? [event.source.asset, event.source.line, event.source.column]
        .filter((part) => part !== undefined)
        .join(":")
    : "Not reported";

  return (
    <div className="min-h-0 flex-1 space-y-layout-md overflow-y-auto p-layout-lg">
      <div className="flex flex-wrap items-center gap-layout-xs">
        <ClientErrorLevelBadge level={event.level} />
        <Badge
          className="border-border bg-muted text-muted-foreground"
          variant="outline"
        >
          {event.flow}
        </Badge>
      </div>
      <p className="text-sm text-foreground">{event.message}</p>

      <dl className="grid grid-cols-1 gap-layout-sm sm:grid-cols-2">
        <ClientErrorFact
          label="Occurred"
          value={formatTerminalTimestamp(event.occurredAt)}
        />
        <ClientErrorFact
          label="Received"
          value={formatTerminalTimestamp(event.receivedAt)}
        />
        <ClientErrorFact
          label="App version"
          value={event.appVersion ?? "Not reported"}
        />
        <ClientErrorFact
          label="Build SHA"
          value={event.buildSha ?? "Not reported"}
        />
        <ClientErrorFact label="Classification" value={event.classification} />
        <ClientErrorFact
          label="Operation"
          value={event.operation ?? "Not reported"}
        />
        <ClientErrorFact
          label="Route"
          value={event.routeId ?? "Not reported"}
        />
        <ClientErrorFact label="Source" value={source} />
        <ClientErrorFact
          label="Client-reported terminal"
          value={event.terminalId ?? "Not reported"}
        />
        <ClientErrorFact
          label="Client-reported fingerprint"
          value={event.terminalFingerprint ?? "Not reported"}
        />
        <ClientErrorFact
          label="Client-reported register session"
          value={event.localRegisterSessionId ?? "None"}
        />
        <ClientErrorFact label="Event id" value={event.clientEventId} />
      </dl>

      {event.errorName ? (
        <div>
          <h3 className="text-xs font-medium uppercase text-muted-foreground">
            Error
          </h3>
          <p className="mt-1 break-words text-sm text-foreground">
            {event.errorName}
          </p>
        </div>
      ) : null}

      {Object.keys(event.metadata).length > 0 ? (
        <div>
          <h3 className="text-xs font-medium uppercase text-muted-foreground">
            Metadata
          </h3>
          <dl className="mt-1 space-y-layout-2xs">
            {Object.entries(event.metadata).map(([key, value]) => (
              <div
                className="flex flex-wrap items-baseline gap-x-layout-xs text-sm"
                key={key}
              >
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export type DiagnosticRailHealth =
  "healthy" | "pending" | "degraded" | "not_reported";

function ClientErrorLevelBadge({ level }: { level: "warn" | "error" }) {
  return (
    <Badge
      className={cn(
        level === "error"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-warning/30 bg-warning/15 text-warning",
      )}
      variant="outline"
    >
      {level === "error" ? (
        <CircleAlert aria-hidden="true" className="mr-1 h-3 w-3" />
      ) : (
        <TriangleAlert aria-hidden="true" className="mr-1 h-3 w-3" />
      )}
      {level === "error" ? "Error" : "Warning"}
    </Badge>
  );
}

function ClientErrorFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm text-foreground">{value}</dd>
    </div>
  );
}
