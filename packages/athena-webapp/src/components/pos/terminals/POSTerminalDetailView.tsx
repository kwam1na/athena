import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ShieldCheck,
} from "lucide-react";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "@/components/common/PageLevelHeader";
import { EmptyState } from "@/components/states/empty/empty-state";
import { NoPermissionView } from "@/components/states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "@/components/states/signed-out/ProtectedAdminSignInView";
import { Badge } from "@/components/ui/badge";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  classifyTerminalHealth,
  formatRegisterNumber,
  formatStatusLabel,
  formatTerminalTimestamp,
  getRecentSyncEvents,
  getReviewEvidenceCount,
  getSnapshotAgeSummary,
  getStaffAuthorityLabel,
  getTerminalAttentionReasons,
} from "./terminalHealthPresentation";
import type {
  TerminalHealthDetail,
  TerminalRuntimeStatus,
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

type POSTerminalDetailViewContentProps = {
  detail: TerminalHealthDetail | null;
  isLoading: boolean;
  queryUnavailable?: boolean;
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
    <section className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="mb-layout-md flex items-center gap-layout-xs">
        {icon}
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{value}</div>
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
      <div className="grid gap-layout-sm sm:grid-cols-3">
        <Field
          label="Accepted sequence"
          value={
            syncEvidence.acceptedThroughSequence == null
              ? "No accepted sequence"
              : syncEvidence.acceptedThroughSequence
          }
        />
        <Field
          label="Cursor updated"
          value={formatTerminalTimestamp(syncEvidence.cursorUpdatedAt)}
        />
        <Field
          label="Recent events"
          value={`${sampledEventCount} sampled`}
        />
      </div>
      <div className="mt-layout-md grid gap-layout-sm sm:grid-cols-4">
        <Field label="Accepted" value={syncEvidence.acceptedCount ?? 0} />
        <Field label="Projected" value={syncEvidence.projectedCount ?? 0} />
        <Field label="Held" value={syncEvidence.heldCount ?? 0} />
        <Field label="Rejected" value={syncEvidence.rejectedCount ?? 0} />
      </div>
      <div className="mt-layout-md divide-y divide-border rounded-md border border-border">
        {recentEvents.length === 0 ? (
          <p className="px-layout-md py-layout-sm text-sm text-muted-foreground">
            No recent sync events reported for this terminal.
          </p>
        ) : (
          recentEvents.map((event) => (
            <div
              className="grid gap-layout-xs px-layout-md py-layout-sm text-sm md:grid-cols-[8rem_minmax(0,1fr)_8rem]"
              key={event._id ?? event.localEventId}
            >
              <span className="font-numeric tabular-nums">#{event.sequence}</span>
              <span className="min-w-0 truncate">{event.eventType}</span>
              <span className="text-muted-foreground">{formatStatusLabel(event.status)}</span>
            </div>
          ))
        )}
      </div>
    </DetailPanel>
  );
}

function ConflictSection({
  syncEvidence,
}: {
  syncEvidence: TerminalSyncEvidence;
}) {
  const unresolvedConflicts = syncEvidence.unresolvedConflicts ?? [];
  const reviewCount = getReviewEvidenceCount(syncEvidence);

  return (
    <DetailPanel
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      title="Conflicts and review"
    >
      {unresolvedConflicts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {reviewCount > 0
            ? `${reviewCount} sync item${reviewCount === 1 ? "" : "s"} need review; detailed conflict records were not returned.`
            : "No unresolved cloud sync conflicts are currently reported. Local runtime review, pending sync, or stale check-ins may still need attention above."}
        </p>
      ) : (
        <div className="space-y-layout-sm">
          {unresolvedConflicts.map((conflict) => (
            <div
              className="rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm"
              key={conflict._id}
            >
              <p className="text-sm font-medium text-foreground">
                {conflict.summary}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sequence {conflict.sequence} / {formatStatusLabel(conflict.conflictType)}
              </p>
            </div>
          ))}
        </div>
      )}
    </DetailPanel>
  );
}

function AttentionReasonsSection({
  detail,
}: {
  detail: TerminalHealthDetail;
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
            <p className="text-sm font-medium text-foreground">
              {reason.summary}
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
        ))}
      </div>
    </DetailPanel>
  );
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
            <li className="rounded-md border border-border bg-background px-layout-md py-layout-sm" key={note}>
              {note}
            </li>
          ))}
        </ul>
      )}
    </DetailPanel>
  );
}

export function POSTerminalDetailViewContent({
  detail,
  isLoading,
  queryUnavailable = false,
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
            <Badge className="border-border bg-surface-raised text-muted-foreground" variant="outline">
              {formatRegisterNumber(detail.terminal.registerNumber)}
            </Badge>
          </div>

          <div className="grid gap-layout-lg xl:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="space-y-layout-md">
              <DetailPanel title="Identity">
                <div className="space-y-layout-sm">
                  <Field label="Register" value={formatRegisterNumber(detail.terminal.registerNumber)} />
                  <Field label="Status" value={formatStatusLabel(detail.terminal.status)} />
                  <Field label="Registered" value={formatTerminalTimestamp(detail.terminal.registeredAt)} />
                </div>
              </DetailPanel>

              <DetailPanel
                icon={<Clock3 className="h-4 w-4 text-muted-foreground" />}
                title="Latest check-in"
              >
                <div className="space-y-layout-sm">
                  <Field label="Received" value={formatTerminalTimestamp(runtimeStatus?.receivedAt)} />
                  <Field label="Source" value={runtimeStatus ? formatStatusLabel(runtimeStatus.source) : "No check-in"} />
                  <Field label="Browser online" value={runtimeStatus?.browserInfo?.online === false ? "No" : runtimeStatus ? "Yes" : "Not reported"} />
                  <Field label="Snapshots" value={getSnapshotAgeSummary(runtimeStatus?.snapshots)} />
                  <Field label="Staff authority" value={getStaffAuthorityLabel(runtimeStatus?.staffAuthority)} />
                </div>
              </DetailPanel>
            </aside>

            <main className="space-y-layout-md">
              <AttentionReasonsSection detail={detail} />
              <SyncEvidenceSection syncEvidence={detail.syncEvidence} />
              <ConflictSection syncEvidence={detail.syncEvidence} />
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
    isLoading: isLoadingPermissions,
  } = usePermissions();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
        terminalId?: string;
      }
    | undefined;
  const isLoadingAccess = isLoadingUser || isLoadingStores || isLoadingPermissions;
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
        isLoading={detail === undefined}
        queryUnavailable={detail === null && !params.terminalId}
      />
  );
}

export default POSTerminalDetailView;
