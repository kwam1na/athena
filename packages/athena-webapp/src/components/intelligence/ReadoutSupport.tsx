import { Bug, ChevronDown, FileText } from "lucide-react";

import { Id } from "~/convex/_generated/dataModel";

export type IntelligenceArtifactSummary = {
  _id?: Id<"intelligenceArtifact">;
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

export type IntelligenceDebugError = {
  code: string;
  diagnostic?: string;
  message: string;
  retryable?: boolean;
};

export type IntelligenceRunDebug = {
  run: {
    _id: string;
    artifactId?: string;
    attemptCount: number;
    capability: string;
    completedAt?: number;
    contextSnapshotId?: string;
    createdAt: number;
    dataWindowEndAt?: number;
    dataWindowStartAt?: number;
    error?: IntelligenceDebugError;
    idempotencyKey: string;
    providerKey: string;
    providerModel?: string;
    snapshotHash?: string;
    status: string;
    trigger: string;
    updatedAt: number;
    visibilityMode: string;
  };
  snapshot: {
    _id: string;
    createdAt: number;
    payloadRedaction?: string;
    payloadSummary: Record<string, unknown>;
    snapshotHash: string;
    sourceRefCount: number;
  } | null;
  artifact: {
    _id: string;
    confidence?: number;
    createdAt: number;
    evidenceCount: number;
    limitedEvidence?: boolean;
    status: string;
    summary?: string;
    title?: string;
    updatedAt: number;
  } | null;
  providerInvocations: Array<{
    _id: string;
    completedAt?: number;
    error?: IntelligenceDebugError;
    providerKey: string;
    providerModel?: string;
    rawPayloadStored: boolean;
    requestSummary: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
    startedAt: number;
    status: string;
  }>;
};

export function ReadoutTrustMetadata({
  artifact,
  compact = false,
}: {
  artifact: IntelligenceArtifactSummary;
  compact?: boolean;
}) {
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
  const evidence = `${artifact.evidenceRefs?.length ?? 0} refs${
    artifact.limitedEvidence ? " · limited" : ""
  }`;

  if (compact) {
    return (
      <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md text-sm leading-6 text-muted-foreground">
        <p>
          {formatReadoutStatus(artifact.status)} · Generated{" "}
          {new Date(artifact.createdAt).toLocaleString()} · {dataWindow}
        </p>
        <p>
          {confidence} · {evidence}
        </p>
        {typeof artifact.payload?.rationale === "string" ? (
          <p className="mt-2 border-t border-border/70 pt-2">
            {artifact.payload.rationale}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
      <div className="flex items-center gap-2 text-muted-foreground">
        <FileText aria-hidden="true" className="h-4 w-4" />
        <h3 className="text-xs font-medium uppercase tracking-[0.16em]">
          Readout status
        </h3>
      </div>
      <dl className="mt-layout-sm space-y-3 text-sm">
        <DebugRow label="Status" value={formatReadoutStatus(artifact.status)} />
        <DebugRow
          label="Generated"
          value={new Date(artifact.createdAt).toLocaleString()}
        />
        <DebugRow label="Data window" value={dataWindow} />
        <DebugRow label="Confidence" value={confidence} />
        <DebugRow label="Evidence" value={evidence} />
      </dl>
      {typeof artifact.payload?.rationale === "string" ? (
        <p className="mt-layout-sm border-t border-border/70 pt-layout-sm text-sm leading-6 text-muted-foreground">
          {artifact.payload.rationale}
        </p>
      ) : null}
    </section>
  );
}

export function IntelligenceDebugView({
  debug,
  emptyMessage,
  expanded,
  layout = "stacked",
  onToggle,
}: {
  debug: IntelligenceRunDebug | null | undefined;
  emptyMessage: string;
  expanded: boolean;
  layout?: "grid" | "stacked";
  onToggle: () => void;
}) {
  const latestInvocation = debug?.providerInvocations?.[0];

  return (
    <section className="border-t border-border/70 bg-surface-raised/60 px-layout-md py-layout-sm">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-layout-md rounded-md px-1 py-1 text-left transition-colors duration-standard ease-standard hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-workflow/40"
        onClick={onToggle}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Bug aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              Intelligence debug
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {getDebugSummary(debug, latestInvocation)}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-standard ease-standard ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded ? (
        <div
          className={`mt-layout-sm gap-layout-md text-sm ${
            layout === "grid"
              ? "grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]"
              : "space-y-layout-md"
          }`}
        >
          {debug === undefined ? (
            <p className="text-muted-foreground">Loading debug details.</p>
          ) : debug === null ? (
            <p className="text-muted-foreground">{emptyMessage}</p>
          ) : (
            <>
              <div className="space-y-layout-md">
                <DebugGrid
                  rows={[
                    ["Run", debug.run._id],
                    ["Status", formatReadoutStatus(debug.run.status)],
                    ["Provider", formatProvider(debug.run)],
                    ["Attempt", String(debug.run.attemptCount)],
                    ["Created", formatDebugTime(debug.run.createdAt)],
                    ["Updated", formatDebugTime(debug.run.updatedAt)],
                    ["Completed", formatDebugTime(debug.run.completedAt)],
                    ["Snapshot", debug.run.snapshotHash ?? "Not captured"],
                    ["Idempotency", debug.run.idempotencyKey],
                  ]}
                />
                {debug.run.error ? (
                  <DebugError title="Run error" error={debug.run.error} />
                ) : null}
                <DebugSummaryBlock
                  label="Snapshot summary"
                  note={debug.snapshot?.payloadRedaction}
                  value={debug.snapshot?.payloadSummary ?? null}
                />
              </div>

              <aside className="space-y-layout-md">
                <DebugGrid
                  rows={[
                    ["Invocations", String(debug.providerInvocations.length)],
                    [
                      "Latest provider",
                      latestInvocation
                        ? formatProvider(latestInvocation)
                        : "No provider call recorded",
                    ],
                    [
                      "Latest status",
                      latestInvocation
                        ? formatReadoutStatus(latestInvocation.status)
                        : "Not started",
                    ],
                    [
                      "Raw payload",
                      latestInvocation?.rawPayloadStored ? "Stored" : "Not stored",
                    ],
                    [
                      "Artifact",
                      debug.artifact
                        ? `${formatReadoutStatus(debug.artifact.status)}${
                            typeof debug.artifact.confidence === "number"
                              ? ` · ${Math.round(debug.artifact.confidence * 100)}%`
                              : ""
                          }`
                        : "No artifact",
                    ],
                    [
                      "Evidence",
                      debug.artifact
                        ? `${debug.artifact.evidenceCount} refs${
                            debug.artifact.limitedEvidence ? " · limited" : ""
                          }`
                        : "No artifact",
                    ],
                  ]}
                />
                {latestInvocation?.error ? (
                  <DebugError title="Provider error" error={latestInvocation.error} />
                ) : null}
                <DebugSummaryBlock
                  label="Request summary"
                  value={latestInvocation?.requestSummary ?? null}
                />
                <DebugSummaryBlock
                  label="Response summary"
                  value={latestInvocation?.responseSummary ?? null}
                />
              </aside>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function DebugGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 rounded-lg border border-border bg-background px-layout-md py-layout-md">
      {rows.map(([label, value]) => (
        <DebugRow key={label} label={label} value={value} />
      ))}
    </dl>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}

function DebugError({
  error,
  title,
}: {
  error: IntelligenceDebugError;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-destructive/30 bg-destructive/5 px-layout-md py-layout-sm">
      <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-destructive">
        {title}
      </h3>
      <p className="mt-2 font-mono text-xs text-foreground">{error.code}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {error.message}
        {error.retryable ? " Retryable." : ""}
      </p>
      {error.diagnostic ? (
        <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
          {error.diagnostic}
        </p>
      ) : null}
    </section>
  );
}

function DebugSummaryBlock({
  label,
  note,
  value,
}: {
  label: string;
  note?: string;
  value: Record<string, unknown> | null;
}) {
  return (
    <section className="rounded-lg border border-border bg-background px-layout-md py-layout-md">
      <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </h3>
      {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
      <dl className="mt-layout-sm grid gap-2">
        {value ? (
          Object.entries(value).map(([key, entry]) => (
            <DebugRow key={key} label={key} value={formatSummaryValue(entry)} />
          ))
        ) : (
          <DebugRow label="Data" value="No data recorded." />
        )}
      </dl>
    </section>
  );
}

function getDebugSummary(
  debug: IntelligenceRunDebug | null | undefined,
  latestInvocation?: IntelligenceRunDebug["providerInvocations"][number],
) {
  if (debug === undefined) return "Loading latest run details";
  if (debug === null) return "No run recorded yet";

  const providerStatus = latestInvocation
    ? `${latestInvocation.providerKey} ${latestInvocation.status}`
    : "provider not started";

  return `${debug.run.status} · ${providerStatus} · ${formatDebugTime(
    debug.run.updatedAt,
  )}`;
}

function formatProvider(input: { providerKey: string; providerModel?: string }) {
  return input.providerModel
    ? `${input.providerKey} / ${input.providerModel}`
    : input.providerKey;
}

function formatDebugTime(value?: number) {
  return typeof value === "number" ? new Date(value).toLocaleString() : "Not recorded";
}

function formatSummaryValue(value: unknown) {
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value === undefined || value === null ? "Not recorded" : String(value);
}

function formatReadoutStatus(status: string) {
  return status
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
