import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MonitorUp,
  Send,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
} from "@/components/common/PageLevelHeader";
import { EmptyState } from "@/components/states/empty/empty-state";
import { NoPermissionView } from "@/components/states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "@/components/states/signed-out/ProtectedAdminSignInView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { runCommand } from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import { cn } from "@/lib/utils";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  buildTerminalRecoveryPresentation,
  classifyTerminalHealth,
  formatRegisterNumber,
  formatStatusLabel,
  formatTerminalTimestamp,
  getRecentSyncEvents,
  getReviewEvidenceCount,
  getSnapshotAgeSummary,
  getStaffAuthorityLabel,
  getSupportSafeAttentionReasonSummary,
  getTerminalAttentionReasons,
  type TerminalRecoveryPresentationBlocker,
} from "./terminalHealthPresentation";
import type {
  TerminalHealthDetail,
  TerminalHealthAttentionReason,
  TerminalRuntimeStatus,
  TerminalSyncEvent,
  TerminalSyncEvidence,
} from "./terminalHealthTypes";

const posTerminalApi = api.inventory.posTerminal as unknown as {
  getTerminalHealthDetail: FunctionReference<
    "query",
    "public",
    { storeId: Id<"store">; terminalId: Id<"posTerminal"> },
    TerminalHealthDetail | null
  >;
};

type RemoteAssistClientSummary = {
  _id: Id<"remoteAssistClient"> | string;
  accessPolicy:
    | "attended_required"
    | "disabled"
    | "unattended_allowed"
    | string;
  displayName: string;
  enrollmentStatus: "active" | "disabled" | "revoked" | string;
  lastPresenceAt?: number;
  presenceStatus: "offline" | "online" | "stale" | "unknown" | string;
};

type RemoteAssistStartResult =
  | {
      kind: "ok";
      data: RemoteAssistSessionSummary;
    }
  | {
      kind: "user_error";
      error: {
        code?: string;
        message: string;
      };
    }
  | {
      kind: "approval_required";
      approval: ApprovalRequirement;
    };

type RemoteAssistSessionSummary = {
  _id: Id<"remoteAssistSession"> | string;
  effectiveMode: "attended" | "unattended" | string;
  expiresAt?: number;
  reason?: string;
  status: string;
};

const remoteAssistApi = api.remoteAssist.public;

const REMOTE_ASSIST_PRESENCE_FRESHNESS_MS = 2 * 60 * 1000;

type POSTerminalDetailViewContentProps = {
  detail: TerminalHealthDetail | null;
  isLoading: boolean;
  onResolveRegisterSessionReview?: (args: {
    registerSessionId: Id<"registerSession"> | string;
  }) => Promise<TerminalRegisterSessionReviewResult>;
  canStartRemoteAssist?: boolean;
  onStartRemoteAssist?: (args: {
    clientId: Id<"remoteAssistClient"> | string;
    reason: string;
  }) => Promise<RemoteAssistStartResult>;
  orgUrlSlug?: string;
  queryUnavailable?: boolean;
  remoteAssistClient?: RemoteAssistClientSummary | null;
  remoteAssistSession?: RemoteAssistSessionSummary | null;
  storeUrlSlug?: string;
};

type TerminalRegisterSessionReviewResult =
  | {
      kind: "ok";
      data?: {
        action?: "already_resolved" | "resolved" | string;
        projectedCount?: number;
        resolvedCount?: number;
      };
    }
  | {
      kind: "user_error";
      error: {
        message: string;
      };
    }
  | {
      kind: "unexpected_error";
      error: {
        message: string;
      };
    };

function DetailPanel({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised p-layout-lg shadow-surface">
      <div className="mb-layout-lg flex items-center gap-layout-xs">
        {icon}
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function RailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-layout-2xs">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <div className="text-sm leading-5 text-foreground">{value}</div>
    </div>
  );
}

function RailSection({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-layout-md p-layout-lg">
      <div className="flex items-center gap-layout-xs">
        {icon}
        <h2 className="text-base font-medium text-foreground">{title}</h2>
      </div>
      <div className="space-y-layout-md">{children}</div>
    </section>
  );
}

function TerminalContextRail({
  detail,
  runtimeStatus,
}: {
  detail: TerminalHealthDetail;
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  return (
    <aside className="self-start overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
      <RailSection title="Identity">
        <RailField
          label="Register"
          value={formatRegisterNumber(detail.terminal.registerNumber)}
        />
        <RailField
          label="Status"
          value={formatStatusLabel(detail.terminal.status)}
        />
        <RailField
          label="Registered"
          value={formatTerminalTimestamp(detail.terminal.registeredAt)}
        />
      </RailSection>

      <div className="border-t border-border/80">
        <RailSection
          icon={<Clock3 className="h-4 w-4 text-muted-foreground" />}
          title="Latest check-in"
        >
          <RailField
            label="Received"
            value={formatTerminalTimestamp(runtimeStatus?.receivedAt)}
          />
          <RailField
            label="Source"
            value={
              runtimeStatus
                ? formatStatusLabel(runtimeStatus.source)
                : "No check-in"
            }
          />
          <RailField
            label="Browser online"
            value={
              runtimeStatus?.browserInfo?.online === false
                ? "No"
                : runtimeStatus
                  ? "Yes"
                  : "Not reported"
            }
          />
          <RailField
            label="Snapshots"
            value={getSnapshotAgeSummary(runtimeStatus?.snapshots)}
          />
          <RailField
            label="Staff authority"
            value={getStaffAuthorityLabel(runtimeStatus?.staffAuthority)}
          />
        </RailSection>
      </div>
    </aside>
  );
}

function SyncMetric({
  detail,
  label,
  tone = "neutral",
  value,
}: {
  detail: string;
  label: string;
  tone?: "danger" | "neutral" | "success" | "warning";
  value: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-surface px-layout-md py-layout-md",
        tone === "success"
          ? "border-success/25 bg-success/5"
          : tone === "warning"
            ? "border-warning/30 bg-warning/10"
            : tone === "danger"
              ? "border-danger/25 bg-danger/5"
              : "border-border/80",
      )}
    >
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-numeric text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function getSyncEventStatusClassName(status: string) {
  switch (status) {
    case "accepted":
    case "projected":
      return "border-success/25 bg-success/10 text-success";
    case "held":
      return "border-warning/30 bg-warning/10 text-warning-foreground";
    case "rejected":
    case "conflicted":
      return "border-danger/25 bg-danger/10 text-danger";
    default:
      return "border-border bg-surface text-muted-foreground";
  }
}

function RecentSyncEventRow({ event }: { event: TerminalSyncEvent }) {
  return (
    <div className="grid gap-layout-sm px-layout-md py-layout-sm text-sm md:grid-cols-[5rem_minmax(0,1fr)_7rem] md:items-center">
      <span className="font-numeric text-xs font-semibold tabular-nums text-muted-foreground">
        #{event.sequence}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">
        {event.eventType}
      </span>
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-md border px-layout-xs py-1 text-xs font-medium",
          getSyncEventStatusClassName(event.status),
        )}
      >
        {formatStatusLabel(event.status)}
      </span>
    </div>
  );
}

function SyncEvidenceSection({
  syncEvidence,
}: {
  syncEvidence: TerminalSyncEvidence;
}) {
  const recentEvents = getRecentSyncEvents(syncEvidence);
  const sampledEventCount =
    syncEvidence.sampledEventCount ?? recentEvents.length;

  return (
    <DetailPanel
      icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
      title="Cloud sync evidence"
    >
      <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
        <div className="grid gap-layout-md md:grid-cols-[minmax(0,1fr)_11rem_10rem] md:items-center">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Accepted through sequence
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-layout-xs">
              <p className="font-numeric text-2xl font-semibold tabular-nums text-foreground">
                {syncEvidence.acceptedThroughSequence == null
                  ? "No sequence"
                  : `#${syncEvidence.acceptedThroughSequence}`}
              </p>
              <p className="text-sm text-muted-foreground">
                latest cloud cursor for this terminal
              </p>
            </div>
          </div>
          <Field
            label="Cursor updated"
            value={formatTerminalTimestamp(syncEvidence.cursorUpdatedAt)}
          />
          <Field label="Recent sample" value={`${sampledEventCount} sampled`} />
        </div>
      </div>

      <div className="mt-layout-md grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
        <SyncMetric
          detail="accepted by cloud"
          label="Accepted"
          tone="success"
          value={syncEvidence.acceptedCount ?? 0}
        />
        <SyncMetric
          detail="applied to read models"
          label="Projected"
          value={syncEvidence.projectedCount ?? 0}
        />
        <SyncMetric
          detail="waiting before projection"
          label="Held"
          tone={(syncEvidence.heldCount ?? 0) > 0 ? "warning" : "neutral"}
          value={syncEvidence.heldCount ?? 0}
        />
        <SyncMetric
          detail="rejected by server"
          label="Rejected"
          tone={(syncEvidence.rejectedCount ?? 0) > 0 ? "danger" : "neutral"}
          value={syncEvidence.rejectedCount ?? 0}
        />
      </div>

      <div className="mt-layout-md overflow-hidden rounded-md border border-border/80 bg-surface">
        <div className="grid gap-layout-sm border-b border-border/80 bg-surface-muted/40 px-layout-md py-layout-xs text-xs font-medium uppercase text-muted-foreground md:grid-cols-[5rem_minmax(0,1fr)_7rem]">
          <span>Sequence</span>
          <span>Event</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-border/80">
          {recentEvents.length === 0 ? (
            <p className="px-layout-md py-layout-sm text-sm text-muted-foreground">
              No recent sync events reported for this terminal.
            </p>
          ) : (
            recentEvents.map((event) => (
              <RecentSyncEventRow
                event={event}
                key={event._id ?? event.localEventId}
              />
            ))
          )}
        </div>
      </div>
    </DetailPanel>
  );
}

function ConflictSection({
  runtimeStatus,
  syncEvidence,
}: {
  runtimeStatus: TerminalRuntimeStatus | null;
  syncEvidence: TerminalSyncEvidence;
}) {
  const localReviewEvents = runtimeStatus?.sync.reviewEvents ?? [];
  const unresolvedConflicts = syncEvidence.unresolvedConflicts ?? [];
  const reviewCount = getReviewEvidenceCount(syncEvidence);

  return (
    <DetailPanel
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      title="Conflicts and review"
    >
      <div className="space-y-layout-sm">
        {unresolvedConflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {reviewCount > 0
              ? `${reviewCount} sync item${reviewCount === 1 ? "" : "s"} need review; detailed conflict records were not returned.`
              : "No unresolved cloud sync conflicts are currently reported. Local runtime review, pending sync, or stale check-ins may still need attention above."}
          </p>
        ) : (
          unresolvedConflicts.map((conflict) => (
            <div
              className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm"
              key={conflict._id}
            >
              <p className="text-sm font-medium text-foreground">
                {conflict.summary}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sequence {conflict.sequence} /{" "}
                {formatStatusLabel(conflict.conflictType)}
              </p>
            </div>
          ))
        )}

        {localReviewEvents.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-border/80 bg-surface">
            <div className="grid gap-layout-sm border-b border-border/80 bg-surface-muted/40 px-layout-md py-layout-xs text-xs font-medium uppercase text-muted-foreground md:grid-cols-[5rem_minmax(0,1fr)_8rem_7rem]">
              <span>Sequence</span>
              <span>Local review item</span>
              <span>Upload</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-border/80">
              {localReviewEvents.map((event) => (
                <div
                  className="grid gap-layout-sm px-layout-md py-layout-sm text-sm md:grid-cols-[5rem_minmax(0,1fr)_8rem_7rem] md:items-center"
                  key={event.localEventId}
                >
                  <span className="font-numeric tabular-nums text-muted-foreground">
                    #{event.sequence}
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {event.type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {event.uploaded
                      ? "Uploaded"
                      : event.uploadSequence == null
                        ? "Local only"
                        : `Upload #${event.uploadSequence}`}
                  </span>
                  <span
                    className={cn(
                      "inline-flex w-fit items-center rounded-md border px-layout-xs py-1 text-xs font-medium",
                      getSyncEventStatusClassName(event.status),
                    )}
                  >
                    {formatStatusLabel(event.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </DetailPanel>
  );
}

function AttentionReasonsSection({
  detail,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  detail: TerminalHealthDetail;
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const reasons = getTerminalAttentionReasons(detail);

  if (reasons.length === 0) {
    return null;
  }

  return (
    <DetailPanel
      icon={<AlertTriangle className="h-4 w-4 text-warning" />}
      title="Why this terminal needs attention"
    >
      <div className="space-y-layout-sm">
        {reasons.map((reason, index) => (
          <div
            className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm"
            key={`${reason.type}-${index}`}
          >
            <div className="flex flex-col gap-layout-sm md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {getSupportSafeAttentionReasonSummary(reason)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reason.source === "cloud_sync"
                    ? "Cloud sync evidence"
                    : reason.source === "local_runtime"
                      ? "Local runtime review"
                      : "Terminal check-in"}
                  {reason.nextPendingUploadSequence == null
                    ? ""
                    : ` / next upload #${reason.nextPendingUploadSequence}`}
                </p>
              </div>
              <AttentionReasonAction
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                reason={reason}
                storeUrlSlug={storeUrlSlug}
              />
            </div>
          </div>
        ))}
      </div>
    </DetailPanel>
  );
}

function AttentionReasonAction({
  onResolveRegisterSessionReview,
  orgUrlSlug,
  reason,
  storeUrlSlug,
}: {
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  reason: TerminalHealthAttentionReason;
  storeUrlSlug?: string;
}) {
  const target = reason.actionTarget;
  const [isResolving, setIsResolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!orgUrlSlug || !storeUrlSlug || !target) {
    return null;
  }

  if (target.type === "cash_control_register_session") {
    const registerSessionId = target.registerSessionId;
    const resolveRegisterSessionReview = onResolveRegisterSessionReview;

    if (resolveRegisterSessionReview) {
      const resolveReview = async () => {
        setIsResolving(true);
        setErrorMessage("");
        const result = await resolveRegisterSessionReview({
          registerSessionId,
        });
        setIsResolving(false);

        if (result.kind === "ok") {
          toast.success(
            result.data?.action === "already_resolved"
              ? "Register review already resolved"
              : "Eligible register review resolved",
          );
          return;
        }

        setErrorMessage(result.error.message);
        toast.error(result.error.message);
      };

      return (
        <div className="grid justify-items-start gap-layout-xs">
          <Button
            disabled={isResolving}
            onClick={() => {
              void resolveReview();
            }}
            size="sm"
            variant="utility"
          >
            <Wrench aria-hidden="true" />
            {isResolving ? "Resolving..." : "Resolve eligible review"}
          </Button>
          {errorMessage ? (
            <p className="max-w-sm text-xs text-danger">{errorMessage}</p>
          ) : null}
        </div>
      );
    }

    return (
      <Button asChild size="sm" variant="utility">
        <Link
          params={{
            orgUrlSlug,
            sessionId: String(target.registerSessionId),
            storeUrlSlug,
          }}
          search={{ o: getOrigin() }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
        >
          Review register session
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  }

  if (target.type === "open_work") {
    return (
      <Button asChild size="sm" variant="utility">
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          search={{ o: getOrigin() }}
          to="/$orgUrlSlug/store/$storeUrlSlug/operations/open-work"
        >
          Review open work
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  }

  if (target.type === "pos_settings") {
    return (
      <p className="max-w-sm text-xs text-muted-foreground">
        Terminal setup repair must run from this checkout station or through a
        terminal repair command when available.
      </p>
    );
  }

  if (target.type === "pos_register") {
    return (
      <p className="max-w-sm text-xs text-muted-foreground">
        This needs a fresh check-in or terminal-side repair before support can
        clear it remotely.
      </p>
    );
  }

  return null;
}

function RecoveryMetric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-sm">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function RecoveryBlockerGroup({
  blockers,
  emptyCopy,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
  title,
}: {
  blockers: TerminalRecoveryPresentationBlocker[];
  emptyCopy: string;
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
  title: string;
}) {
  return (
    <div className="rounded-md border border-border/80 bg-surface">
      <div className="border-b border-border/80 bg-surface-muted/40 px-layout-md py-layout-xs">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="divide-y divide-border/80">
        {blockers.length === 0 ? (
          <p className="px-layout-md py-layout-sm text-sm text-muted-foreground">
            {emptyCopy}
          </p>
        ) : (
          blockers.map((blocker) => (
            <div
              className="grid gap-layout-sm px-layout-md py-layout-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
              key={blocker.id}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {blocker.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {blocker.summary}
                </p>
                {blocker.detail ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {blocker.detail}
                  </p>
                ) : null}
              </div>
              <RecoveryBlockerAction
                blocker={blocker}
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RecoveryBlockerAction({
  blocker,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  blocker: TerminalRecoveryPresentationBlocker;
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const action = blocker.action;
  if (action && ["cloud_repair", "terminal_command"].includes(action.kind)) {
    return (
      <Button disabled size="sm" variant="utility">
        {action.kind === "terminal_command" ? (
          <Send aria-hidden="true" />
        ) : (
          <Wrench aria-hidden="true" />
        )}
        {action.label}
      </Button>
    );
  }

  if (blocker.actionTarget) {
    return (
      <AttentionReasonAction
        onResolveRegisterSessionReview={onResolveRegisterSessionReview}
        orgUrlSlug={orgUrlSlug}
        reason={{
          actionTarget: blocker.actionTarget,
          source: "terminal_runtime",
          summary: blocker.summary,
          type: "manual_review",
        }}
        storeUrlSlug={storeUrlSlug}
      />
    );
  }

  return null;
}

function RecoveryPanel({
  detail,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  detail: TerminalHealthDetail;
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const recovery = buildTerminalRecoveryPresentation(detail);

  return (
    <DetailPanel
      icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
      title="Support recovery"
    >
      <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-sm md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Readiness
            </p>
            <p className="mt-1 text-base font-medium text-foreground">
              {recovery.readiness.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {recovery.readiness.description}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-layout-md grid gap-layout-sm md:grid-cols-3">
        <RecoveryMetric
          label="Command status"
          value={`${recovery.commandStatus.label} / ${recovery.commandStatus.status}`}
        />
        <RecoveryMetric
          label="Verification"
          value={recovery.commandStatus.verificationStatus}
        />
        <RecoveryMetric
          label="Available actions"
          value={`${recovery.safeActions.length} safe action${recovery.safeActions.length === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mt-layout-md space-y-layout-sm">
        <RecoveryBlockerGroup
          blockers={recovery.groups.cloudRepair}
          emptyCopy="No cloud-safe repair blockers are reported."
          onResolveRegisterSessionReview={onResolveRegisterSessionReview}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
          title="Cloud repair"
        />
        <RecoveryBlockerGroup
          blockers={recovery.groups.terminalRequired}
          emptyCopy="No terminal-required blockers are reported."
          onResolveRegisterSessionReview={onResolveRegisterSessionReview}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
          title="Terminal required"
        />
        <RecoveryBlockerGroup
          blockers={recovery.groups.manualReview}
          emptyCopy="No manual-review blockers are reported."
          onResolveRegisterSessionReview={onResolveRegisterSessionReview}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
          title="Manual review"
        />
      </div>

      <p className="mt-layout-md text-sm text-muted-foreground">
        {recovery.verification.summary}
      </p>
    </DetailPanel>
  );
}

function RemoteAssistPanel({
  canStartRemoteAssist = false,
  client,
  detail,
  currentSession,
  onStartRemoteAssist,
}: {
  canStartRemoteAssist?: boolean;
  client?: RemoteAssistClientSummary | null;
  currentSession?: RemoteAssistSessionSummary | null;
  detail: TerminalHealthDetail;
  onStartRemoteAssist?: POSTerminalDetailViewContentProps["onStartRemoteAssist"];
}) {
  const [reason, setReason] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [requestedSession, setRequestedSession] =
    useState<RemoteAssistSessionSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timerId);
  }, []);
  useEffect(() => {
    setRequestedSession(null);
  }, [client?._id]);
  useEffect(() => {
    if (currentSession) {
      setRequestedSession(currentSession);
    }
  }, [currentSession]);
  const presenceFresh = isRemoteAssistPresenceFresh(client, now);
  const available =
    canStartRemoteAssist &&
    client?.enrollmentStatus === "active" &&
    client?.accessPolicy === "unattended_allowed" &&
    client?.presenceStatus === "online" &&
    presenceFresh;
  const sessionInProgress =
    requestedSession &&
    !["ended", "expired"].includes(requestedSession.status);
  const availabilityCopy = getRemoteAssistAvailabilityCopy(
    client,
    presenceFresh,
    canStartRemoteAssist,
  );

  async function handleStartRemoteAssist() {
    if (!client || !onStartRemoteAssist || !available) {
      return;
    }
    setIsStarting(true);
    try {
      const result = await onStartRemoteAssist({
        clientId: client._id,
        reason,
      });
      if (result.kind === "ok") {
        setRequestedSession(result.data);
        toast.success("Remote Assist session requested.");
      } else if (result.kind === "approval_required") {
        toast.error(
          result.approval.copy.message ||
            "Local approval is required before Remote Assist can continue.",
        );
      } else {
        toast.error(result.error.message);
      }
    } catch {
      toast.error("Remote Assist could not start right now.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <DetailPanel
      icon={<MonitorUp className="h-4 w-4 text-muted-foreground" />}
      title="Remote Assist"
    >
      <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Availability
            </p>
            <p className="mt-1 text-base font-medium text-foreground">
              {availabilityCopy.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {availabilityCopy.description}
            </p>
            {client?.lastPresenceAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Last Remote Assist presence{" "}
                {formatTerminalTimestamp(client.lastPresenceAt)}.
              </p>
            ) : null}
          </div>

          <Badge
            className={cn(
              "w-fit border",
              available
                ? "border-success/25 bg-success/5 text-success"
                : "border-border bg-background text-muted-foreground",
            )}
            variant="outline"
          >
            {available ? "Ready" : "Unavailable"}
          </Badge>
        </div>
      </div>

      <div className="mt-layout-md grid gap-layout-sm md:grid-cols-3">
        <RecoveryMetric
          label="Mode"
          value={
            client?.accessPolicy === "attended_required"
              ? "Attended"
              : "Unattended"
          }
        />
        <RecoveryMetric
          label="Runtime"
          value={client?.displayName ?? detail.terminal.displayName}
        />
        <RecoveryMetric
          label="Freshness"
          value={formatTerminalTimestamp(detail.runtimeStatus?.receivedAt)}
        />
      </div>

      {requestedSession ? (
        <div className="mt-layout-md rounded-md border border-blue-200 bg-blue-50 px-layout-md py-layout-md text-blue-950">
          <div className="flex flex-col gap-layout-sm md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-blue-700">
                Session
              </p>
              <p className="mt-1 text-sm font-medium">
                {getRemoteAssistSessionStatusLabel(requestedSession.status)}
              </p>
              <p className="mt-1 text-xs text-blue-800">
                Support request accepted. The terminal runtime still needs to
                join before live assist controls are available.
              </p>
            </div>
            <Badge
              className="w-fit rounded-md border-blue-300 bg-blue-100 text-blue-800"
              variant="outline"
            >
              {formatRemoteAssistModeLabel(requestedSession.effectiveMode)}
            </Badge>
          </div>
        </div>
      ) : null}

      <div className="mt-layout-md grid gap-layout-sm">
        <label
          className="text-xs font-medium uppercase text-muted-foreground"
          htmlFor="remote-assist-reason"
        >
          Reason
        </label>
        <textarea
          className="min-h-20 rounded-md border border-border bg-background px-layout-md py-layout-sm text-sm text-foreground outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring"
          id="remote-assist-reason"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Describe the support task for this session."
          value={reason}
        />
        <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Remote Assist operates this Athena surface only; POS authority and
            recovery gates still apply.
          </p>
          <Button
            disabled={
              !available ||
              !reason.trim() ||
              isStarting ||
              Boolean(sessionInProgress)
            }
            onClick={handleStartRemoteAssist}
            type="button"
            variant="workflow"
          >
            <MonitorUp aria-hidden="true" className="mr-2 h-4 w-4" />
            {isStarting
              ? "Starting"
              : sessionInProgress
                ? "Session requested"
                : "Start session"}
          </Button>
        </div>
      </div>
    </DetailPanel>
  );
}

function getRemoteAssistSessionStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Remote Assist session active";
    case "connecting":
      return "Remote Assist session connecting";
    case "pending_attended_approval":
      return "Waiting for local approval";
    case "ended":
      return "Remote Assist session ended";
    case "expired":
      return "Remote Assist session expired";
    default:
      return "Remote Assist session requested";
  }
}

function formatRemoteAssistModeLabel(mode: string): string {
  return mode === "attended" ? "Attended" : "Unattended";
}

function SupportNotesSection({
  runtimeStatus,
}: {
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  const notes = [
    runtimeStatus?.localStore.failureMessage,
    runtimeStatus?.sync.lastFailureMessage,
    runtimeStatus && !runtimeStatus.localStore.terminalSeedReady
      ? "Terminal seed is not ready on this checkout station."
      : null,
    runtimeStatus?.browserInfo?.online === false
      ? "Browser reported offline during the latest check-in."
      : null,
  ].filter(Boolean);

  return (
    <DetailPanel
      icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      title="Support notes"
    >
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No support notes were reported with the latest check-in.
        </p>
      ) : (
        <ul className="space-y-layout-xs text-sm text-foreground">
          {notes.map((note) => (
            <li
              className="rounded-md border border-border bg-background px-layout-md py-layout-sm"
              key={note}
            >
              {note}
            </li>
          ))}
        </ul>
      )}
    </DetailPanel>
  );
}

function getRemoteAssistAvailabilityCopy(
  client?: RemoteAssistClientSummary | null,
  presenceFresh = false,
  canStartRemoteAssist = false,
) {
  if (!canStartRemoteAssist) {
    return {
      label: "Support permission required",
      description:
        "Only full admin support users can start Remote Assist sessions.",
    };
  }
  if (!client) {
    return {
      label: "Waiting for runtime enrollment",
      description:
        "The terminal will become assistable after its browser publishes a fresh Remote Assist check-in.",
    };
  }
  if (client.accessPolicy === "disabled") {
    return {
      label: "Remote Assist disabled",
      description: "Policy disables Remote Assist for this terminal.",
    };
  }
  if (client.accessPolicy === "attended_required") {
    return {
      label: "Local approval required",
      description:
        "This terminal requires a local approval flow before Remote Assist can start.",
    };
  }
  if (client.enrollmentStatus !== "active") {
    return {
      label: "Runtime not enrolled",
      description: "This terminal is not actively enrolled for Remote Assist.",
    };
  }
  if (client.presenceStatus !== "online" || !presenceFresh) {
    return {
      label: "Runtime not online",
      description:
        "Remote Assist needs a fresh browser check-in before support can start a session.",
    };
  }
  return {
    label: "Ready for support session",
    description:
      client.accessPolicy === "attended_required"
        ? "Policy requires local approval before support can connect."
        : "Unattended support can connect under policy with visible runtime state.",
  };
}

function isRemoteAssistPresenceFresh(
  client: RemoteAssistClientSummary | null | undefined,
  now: number,
) {
  return Boolean(
    client?.lastPresenceAt &&
    now - client.lastPresenceAt <= REMOTE_ASSIST_PRESENCE_FRESHNESS_MS,
  );
}

export function POSTerminalDetailViewContent({
  canStartRemoteAssist = false,
  detail,
  isLoading,
  onResolveRegisterSessionReview,
  onStartRemoteAssist,
  orgUrlSlug,
  queryUnavailable = false,
  remoteAssistClient,
  remoteAssistSession,
  storeUrlSlug,
}: POSTerminalDetailViewContentProps) {
  if (queryUnavailable) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <EmptyState
            description="Try again from POS after the terminal detail query is available."
            icon={<AlertTriangle className="h-16 w-16 text-warning" />}
            title="Terminal detail is not available right now"
          />
        </FadeIn>
      </View>
    );
  }

  if (isLoading) {
    return null;
  }

  if (!detail) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <EmptyState
            description="This checkout station is not registered for the selected store."
            icon={<AlertTriangle className="h-16 w-16 text-muted-foreground" />}
            title="Terminal not found"
          />
        </FadeIn>
      </View>
    );
  }

  const classification = classifyTerminalHealth(detail);
  const runtimeStatus = detail.runtimeStatus;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="POS terminal"
            showBackButton
            title={detail.terminal.displayName}
            description="Inspect the latest terminal check-in, cloud sync evidence, and support notes."
          />

          <div className="flex flex-wrap gap-layout-xs">
            <Badge className={classification.toneClassName} variant="outline">
              {classification.label}
            </Badge>
            <Badge
              className="border-border bg-surface-raised text-muted-foreground"
              variant="outline"
            >
              {formatRegisterNumber(detail.terminal.registerNumber)}
            </Badge>
          </div>

          <div className="grid gap-layout-xl xl:grid-cols-[20rem_minmax(0,1fr)]">
            <TerminalContextRail
              detail={detail}
              runtimeStatus={runtimeStatus}
            />

            <main className="space-y-layout-lg">
              <RemoteAssistPanel
                canStartRemoteAssist={canStartRemoteAssist}
                client={remoteAssistClient}
                currentSession={remoteAssistSession}
                detail={detail}
                onStartRemoteAssist={onStartRemoteAssist}
              />
              <RecoveryPanel
                detail={detail}
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
              <AttentionReasonsSection
                detail={detail}
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
              <SyncEvidenceSection syncEvidence={detail.syncEvidence} />
              <ConflictSection
                runtimeStatus={detail.runtimeStatus}
                syncEvidence={detail.syncEvidence}
              />
              <SupportNotesSection runtimeStatus={runtimeStatus} />
            </main>
          </div>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function POSTerminalDetailView() {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const {
    canAccessPOS,
    hasFullAdminAccess,
    isLoading: isLoadingPermissions,
  } = usePermissions();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
        terminalId?: string;
      }
    | undefined;
  const isLoadingAccess =
    isLoadingUser || isLoadingStores || isLoadingPermissions;
  const canViewHealth = canAccessPOS();
  const canQuery = Boolean(
    activeStore?._id && user && canViewHealth && params?.terminalId,
  );
  const detail = useQuery(
    posTerminalApi.getTerminalHealthDetail,
    canQuery
      ? {
          storeId: activeStore!._id,
          terminalId: params!.terminalId as Id<"posTerminal">,
        }
      : "skip",
  ) as TerminalHealthDetail | null | undefined;
  const remoteAssistClient = useQuery(
    remoteAssistApi.getClientByRuntime,
    canQuery && activeStore?.organizationId
      ? {
          organizationId: activeStore.organizationId as Id<"organization">,
          runtimeIdentity: params!.terminalId as string,
          runtimeType: "pos_terminal",
        }
      : "skip",
  ) as RemoteAssistClientSummary | null | undefined;
  const remoteAssistSession = useQuery(
    remoteAssistApi.getCurrentSessionByClient,
    remoteAssistClient?._id
      ? {
          clientId: remoteAssistClient._id as Id<"remoteAssistClient">,
        }
      : "skip",
  ) as RemoteAssistSessionSummary | null | undefined;
  const resolveRegisterSessionSyncReview = useMutation(
    api.cashControls.deposits.resolveRegisterSessionSyncReview,
  );
  const startRemoteAssistSession = useMutation(remoteAssistApi.startSession);

  async function onResolveRegisterSessionReview({
    registerSessionId,
  }: {
    registerSessionId: Id<"registerSession"> | string;
  }): Promise<TerminalRegisterSessionReviewResult> {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          message: "Select a store before resolving this register review.",
        },
      };
    }

    return runCommand(() =>
      resolveRegisterSessionSyncReview({
        registerSessionId: registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      }),
    ) as Promise<TerminalRegisterSessionReviewResult>;
  }

  async function onStartRemoteAssist({
    clientId,
    reason,
  }: {
    clientId: Id<"remoteAssistClient"> | string;
    reason: string;
  }): Promise<RemoteAssistStartResult> {
    return startRemoteAssistSession({
      clientId: clientId as Id<"remoteAssistClient">,
      metadata: {
        source: "terminal_health",
        terminalId: params?.terminalId ?? "unknown",
      },
      reason,
      requestedMode: "unattended",
    }) as Promise<RemoteAssistStartResult>;
  }

  if (isLoadingAccess) {
    return null;
  }

  if (!user) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before POS terminal health can load." />
    );
  }

  if (!canViewHealth) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening POS terminal detail."
            icon={<AlertTriangle className="h-16 w-16 text-muted-foreground" />}
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <POSTerminalDetailViewContent
      detail={detail ?? null}
      canStartRemoteAssist={hasFullAdminAccess}
      isLoading={detail === undefined}
      onResolveRegisterSessionReview={onResolveRegisterSessionReview}
      onStartRemoteAssist={onStartRemoteAssist}
      orgUrlSlug={params.orgUrlSlug}
      queryUnavailable={detail === null && !params.terminalId}
      remoteAssistClient={remoteAssistClient ?? null}
      remoteAssistSession={remoteAssistSession ?? null}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}

export default POSTerminalDetailView;
