import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Heart,
  MonitorUp,
  Send,
  ShieldCheck,
  Trash2,
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RemoteAssistSupportConsole } from "@/components/remote-assist/RemoteAssistSupportConsole";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { runCommand } from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import {
  readRuntimeBuildMetadata,
  type AthenaWebappRuntimeBuildMetadata,
} from "@/lib/runtimeBuildMetadata";
import { cn } from "@/lib/utils";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import {
  buildTerminalOperationalExplanationPresentation,
  buildTerminalRecoveryPresentation,
  classifyTerminalHealth,
  formatAge,
  formatRegisterNumber,
  formatStatusLabel,
  formatTerminalTimestamp,
  getReviewEvidenceCount,
  getStaffAuthorityLabel,
  getSupportSafeAttentionReasonSummary,
  getTerminalAttentionReasons,
  isRecoveryActionIssuable,
  type TerminalRecoveryPresentationBlocker,
} from "./terminalHealthPresentation";
import type {
  TerminalHealthDetail,
  TerminalHealthAttentionReason,
  TerminalRecoveryAction,
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

const TERMINAL_DETAIL_LIST_VISIBLE_LIMIT = 5;

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
      data: {
        _id: Id<"remoteAssistSession"> | string;
        effectiveMode: "attended" | "unattended" | string;
        status: string;
      };
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
  endedAt?: number;
  expiresAt: number;
  reason: string;
  sensitiveModeActive: boolean;
  startedAt?: number;
  status: string;
  terminationReason?: string;
};

type RemoteAssistEndResult =
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
    };

const remoteAssistApi = api.remoteAssist.public;

const REMOTE_ASSIST_PRESENCE_FRESHNESS_MS = 2 * 60 * 1000;

type POSTerminalDetailViewContentProps = {
  detail: TerminalHealthDetail | null;
  isLoading: boolean;
  onDisconnectTerminal?: (args: {
    terminalId: Id<"posTerminal"> | string;
  }) => Promise<void>;
  onIssueTerminalRecoveryCommand?: (args: {
    action: TerminalRecoveryAction;
    terminalId: Id<"posTerminal"> | string;
  }) => Promise<TerminalRecoveryMutationResult>;
  onResolveTerminalCloudRepair?: (args: {
    action: TerminalRecoveryAction;
    terminalId: Id<"posTerminal"> | string;
  }) => Promise<TerminalRecoveryMutationResult>;
  onResolveRegisterSessionReview?: (args: {
    registerSessionId: Id<"registerSession"> | string;
  }) => Promise<TerminalRegisterSessionReviewResult>;
  canStartRemoteAssist?: boolean;
  onStartRemoteAssist?: (args: {
    clientId: Id<"remoteAssistClient"> | string;
    reason: string;
  }) => Promise<RemoteAssistStartResult>;
  onEndRemoteAssist?: (args: {
    reason: string;
    sessionId: Id<"remoteAssistSession"> | string;
  }) => Promise<RemoteAssistEndResult>;
  onSetTerminalHeartbeat?: (args: {
    heartbeatEnabled: boolean;
    terminalId: Id<"posTerminal"> | string;
  }) => Promise<void>;
  orgUrlSlug?: string;
  queryUnavailable?: boolean;
  remoteAssistClient?: RemoteAssistClientSummary | null;
  remoteAssistSession?: RemoteAssistSessionSummary | null;
  storeName?: string;
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

type TerminalRecoveryMutationResult =
  | {
      kind: "ok";
      data?: unknown;
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

function DisconnectTerminalPanel({
  detail,
  onDisconnectTerminal,
  storeName,
}: {
  detail: TerminalHealthDetail;
  onDisconnectTerminal?: POSTerminalDetailViewContentProps["onDisconnectTerminal"];
  storeName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!onDisconnectTerminal) return null;

  const isActive = detail.terminal.status === "active";

  async function handleDisconnect() {
    if (!isActive || isDisconnecting) return;

    setIsDisconnecting(true);
    setErrorMessage(null);
    try {
      await onDisconnectTerminal!({ terminalId: detail.terminal._id });
      setIsOpen(false);
      toast.success(`${detail.terminal.displayName} was disconnected.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : "Unable to disconnect this checkout station. Try again.",
      );
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <DetailPanel
      icon={<Trash2 className="h-4 w-4" />}
      title="Checkout station access"
    >
      <div className="space-y-layout-sm">
        <p className="text-sm text-muted-foreground">
          {isActive
            ? "Disconnect this checkout station when it should no longer request POS access for this store."
            : "This checkout station is disconnected. Its recorded health and sync evidence remain available for inspection."}
        </p>
        {isActive ? (
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              if (isDisconnecting) return;
              setIsOpen(open);
              if (!open) setErrorMessage(null);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive">Disconnect checkout station</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Disconnect checkout station</DialogTitle>
                <DialogDescription>
                  Disconnect {detail.terminal.displayName} from {storeName}?
                </DialogDescription>
              </DialogHeader>

              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>Its next server request for POS access will be denied.</li>
                <li>
                  Offline access already leased to it remains available only
                  until the current lease expires.
                </li>
                <li>
                  Unsynchronized records stay on this checkout station and are
                  not deleted.
                </li>
                <li>Other checkout stations at {storeName} are unaffected.</li>
              </ul>

              {errorMessage ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}

              <DialogFooter>
                <DialogClose asChild>
                  <Button disabled={isDisconnecting} variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={isDisconnecting}
                  onClick={() => void handleDisconnect()}
                  variant="destructive"
                >
                  {isDisconnecting
                    ? "Disconnecting…"
                    : "Disconnect checkout station"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </DetailPanel>
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

function getStaffAuthorityTone(
  status?: TerminalRuntimeStatus["staffAuthority"] | null,
) {
  switch (status?.status) {
    case "ready":
      return "success";
    case "expired":
    case "missing":
      return "warning";
    default:
      return "neutral";
  }
}

function getDrawerAuthorityTone(runtimeStatus?: TerminalRuntimeStatus | null) {
  if (!runtimeStatus) {
    return "neutral";
  }

  if (
    !runtimeStatus.drawerAuthority ||
    runtimeStatus.drawerAuthority.status === "healthy"
  ) {
    return "success";
  }

  if (runtimeStatus.drawerAuthority.status === "blocked") {
    return "warning";
  }

  return "neutral";
}

function ReadyReadinessValue() {
  return (
    <span className="inline-flex items-center justify-end gap-1 text-success">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      <span>Ready</span>
    </span>
  );
}

function ExpiredReadinessValue() {
  return (
    <span className="inline-flex items-center justify-end gap-1 text-warning">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      <span>Expired</span>
    </span>
  );
}

function DrawerAuthorityReadinessValue({
  runtimeStatus,
}: {
  runtimeStatus?: TerminalRuntimeStatus | null;
}) {
  if (!runtimeStatus) {
    return "Not reported";
  }

  if (
    !runtimeStatus.drawerAuthority ||
    runtimeStatus.drawerAuthority.status === "healthy"
  ) {
    return <ReadyReadinessValue />;
  }

  return formatStatusLabel(runtimeStatus.drawerAuthority.status);
}

function StaffAuthorityReadinessValue({
  status,
}: {
  status?: TerminalRuntimeStatus["staffAuthority"] | null;
}) {
  if (status?.status === "ready") {
    return <ReadyReadinessValue />;
  }

  if (status?.status === "expired") {
    return <ExpiredReadinessValue />;
  }

  return getStaffAuthorityLabel(status);
}

function RailSignalRow({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "success" | "warning";
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-sm py-layout-xs">
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 text-right text-xs font-medium leading-5",
          tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SnapshotReadinessGroup({
  runtimeStatus,
}: {
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  const snapshots = runtimeStatus?.snapshots;
  const staffAuthorityTone = getStaffAuthorityTone(
    runtimeStatus?.staffAuthority,
  );
  const drawerAuthorityTone = getDrawerAuthorityTone(runtimeStatus);

  return (
    <div className="space-y-layout-xs rounded-md border border-border/80 bg-surface px-layout-md py-layout-sm">
      <div className="flex items-center justify-between gap-layout-sm">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Readiness evidence
        </p>
        <span className="text-xs text-muted-foreground">
          {runtimeStatus ? "From latest check-in" : "Not reported"}
        </span>
      </div>
      <div className="divide-y divide-border/70">
        <RailSignalRow
          label="Availability"
          value={formatAge(snapshots?.availabilityAgeMs)}
        />
        <RailSignalRow
          label="Catalog"
          value={formatAge(snapshots?.catalogAgeMs)}
        />
        <RailSignalRow
          label="Service catalog"
          value={formatAge(snapshots?.serviceCatalogAgeMs)}
        />
        <RailSignalRow
          label="Register model"
          value={formatAge(snapshots?.registerReadModelAgeMs)}
        />
        <RailSignalRow
          label="Drawer authority"
          tone={drawerAuthorityTone}
          value={
            <DrawerAuthorityReadinessValue runtimeStatus={runtimeStatus} />
          }
        />
        <RailSignalRow
          label="Staff authority"
          tone={staffAuthorityTone}
          value={
            <StaffAuthorityReadinessValue
              status={runtimeStatus?.staffAuthority}
            />
          }
        />
      </div>
    </div>
  );
}

function RuntimeReportGroup({
  runtimeStatus,
}: {
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  const syncTone = getRuntimeSyncTone(runtimeStatus?.sync.status);
  const appUpdateTone = getRuntimeAppUpdateTone(
    runtimeStatus?.appUpdate?.status,
  );
  const activeRegisterSession = runtimeStatus?.activeRegisterSession;

  return (
    <div className="space-y-layout-xs rounded-md border border-border/80 bg-surface px-layout-md py-layout-sm">
      <div className="flex items-center justify-between gap-layout-sm">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Runtime report
        </p>
        <span className="text-xs text-muted-foreground">
          {runtimeStatus ? "Latest terminal report" : "Not reported"}
        </span>
      </div>
      <div className="divide-y divide-border/70">
        <RailSignalRow
          label="Reported"
          value={formatTerminalTimestamp(runtimeStatus?.reportedAt)}
        />
        <RailSignalRow
          label="Active drawer"
          tone={activeRegisterSession ? "neutral" : "warning"}
          value={
            activeRegisterSession
              ? formatActiveRegisterSession(activeRegisterSession)
              : "Not reported"
          }
        />
        <RailSignalRow
          label="Sync"
          tone={syncTone}
          value={
            runtimeStatus
              ? formatStatusLabel(runtimeStatus.sync.status)
              : "No report"
          }
        />
        <RailSignalRow
          label="Upload queue"
          value={formatUploadQueue(runtimeStatus)}
        />
        <RailSignalRow
          label="Local review"
          tone={
            (runtimeStatus?.sync.reviewEventCount ?? 0) > 0
              ? "warning"
              : "neutral"
          }
          value={formatLocalReviewCount(runtimeStatus)}
        />
        <RailSignalRow
          label="App update"
          tone={appUpdateTone}
          value={
            runtimeStatus?.appUpdate
              ? formatStatusLabel(runtimeStatus.appUpdate.status)
              : "Not reported"
          }
        />
      </div>
    </div>
  );
}

function getRuntimeSyncTone(status?: TerminalRuntimeStatus["sync"]["status"]) {
  switch (status) {
    case "idle":
      return "success";
    case "failed":
    case "needs_review":
    case "pending":
    case "syncing":
      return "warning";
    default:
      return "neutral";
  }
}

function getRuntimeAppUpdateTone(
  status?: TerminalRuntimeStatus["appUpdate"] extends infer AppUpdate
    ? AppUpdate extends { status?: infer Status }
      ? Status
      : never
    : never,
) {
  switch (status) {
    case "current":
      return "success";
    case "applying":
    case "blocked":
    case "checking":
    case "detector_failed":
    case "detector-failed":
    case "ready":
    case "ready_unstaged":
    case "staged":
    case "update_ready":
    case "update_ready_unstaged":
      return "warning";
    default:
      return "neutral";
  }
}

function formatActiveRegisterSession(
  activeRegisterSession: NonNullable<
    TerminalRuntimeStatus["activeRegisterSession"]
  >,
) {
  const registerLabel = activeRegisterSession.registerNumber
    ? `Register ${activeRegisterSession.registerNumber}`
    : "Drawer";

  return `${registerLabel} ${formatStatusLabel(activeRegisterSession.status)}`;
}

function formatUploadQueue(runtimeStatus: TerminalRuntimeStatus | null) {
  if (!runtimeStatus) {
    return "Not reported";
  }

  const uploadable = runtimeStatus.sync.uploadableEventCount;
  const pending = runtimeStatus.sync.pendingEventCount;

  if (uploadable === 0 && pending === 0) {
    return "Clear";
  }

  return `${uploadable} uploadable / ${pending} pending`;
}

function formatLocalReviewCount(runtimeStatus: TerminalRuntimeStatus | null) {
  if (!runtimeStatus) {
    return "Not reported";
  }

  const reviewCount = runtimeStatus.sync.reviewEventCount;

  return `${reviewCount} item${reviewCount === 1 ? "" : "s"}`;
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
  classification,
  detail,
  onSetTerminalHeartbeat,
  runtimeStatus,
}: {
  classification: ReturnType<typeof classifyTerminalHealth>;
  detail: TerminalHealthDetail;
  onSetTerminalHeartbeat?: POSTerminalDetailViewContentProps["onSetTerminalHeartbeat"];
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  return (
    <aside className="self-start overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
      <RailSection title="Identity">
        <div className="grid gap-layout-2xs">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Register
          </p>
          <div className="flex flex-wrap items-center gap-layout-xs">
            <p className="text-sm text-foreground">
              {formatRegisterNumber(detail.terminal.registerNumber)}
            </p>
            <Badge className={classification.toneClassName} variant="outline">
              {classification.label}
            </Badge>
          </div>
        </div>
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
            label="Athena webapp"
            value={<RuntimeBuildVersionStatus runtimeStatus={runtimeStatus} />}
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
          <TerminalHeartbeatRailControl
            detail={detail}
            onSetTerminalHeartbeat={onSetTerminalHeartbeat}
          />
          <RuntimeReportGroup runtimeStatus={runtimeStatus} />
          <SnapshotReadinessGroup runtimeStatus={runtimeStatus} />
        </RailSection>
      </div>
    </aside>
  );
}

function TerminalHeartbeatRailControl({
  detail,
  onSetTerminalHeartbeat,
}: {
  detail: TerminalHealthDetail;
  onSetTerminalHeartbeat?: POSTerminalDetailViewContentProps["onSetTerminalHeartbeat"];
}) {
  const [isSaving, setIsSaving] = useState(false);
  const heartbeatEnabled = detail.terminal.heartbeatEnabled !== false;
  const canChange = Boolean(onSetTerminalHeartbeat);

  async function handleHeartbeatChange(nextHeartbeatEnabled: boolean) {
    if (!onSetTerminalHeartbeat || nextHeartbeatEnabled === heartbeatEnabled) {
      return;
    }

    setIsSaving(true);
    try {
      await onSetTerminalHeartbeat({
        heartbeatEnabled: nextHeartbeatEnabled,
        terminalId: detail.terminal._id,
      });
      toast.success(
        nextHeartbeatEnabled
          ? "Terminal heartbeat resumed."
          : "Terminal heartbeat paused.",
      );
    } catch {
      toast.error("Terminal heartbeat setting could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-background px-layout-sm py-layout-sm">
      <div className="flex items-center justify-between gap-layout-sm">
        <div className="flex min-w-0 items-center gap-layout-xs">
          <Heart aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Heartbeat
            </p>
            <p className="truncate text-sm text-foreground">
              {heartbeatEnabled ? "Sending" : "Paused"}
            </p>
          </div>
        </div>
        <Switch
          aria-label="Send terminal heartbeat"
          checked={heartbeatEnabled}
          disabled={!canChange || isSaving}
          onCheckedChange={(checked) => {
            void handleHeartbeatChange(checked);
          }}
        />
      </div>
    </div>
  );
}

function RuntimeBuildVersionStatus({
  runtimeStatus,
}: {
  runtimeStatus: TerminalRuntimeStatus | null;
}) {
  const [latestBuildMetadata, setLatestBuildMetadata] =
    useState<AthenaWebappRuntimeBuildMetadata | null>(null);

  useEffect(() => {
    let cancelled = false;

    void readRuntimeBuildMetadata().then((metadata) => {
      if (!cancelled) {
        setLatestBuildMetadata(metadata);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const presentation = getRuntimeBuildVersionPresentation(
    runtimeStatus,
    latestBuildMetadata,
  );

  if (presentation.status === "not_reported") {
    return <span>{presentation.label}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex max-w-full items-center text-left text-sm font-medium underline decoration-border decoration-dotted underline-offset-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              presentation.status === "latest" && "text-success",
              presentation.status === "stale" && "text-warning",
              (presentation.status === "checking" ||
                presentation.status === "unknown") &&
                "text-foreground",
            )}
            aria-label={`Athena webapp ${presentation.label}. Version details.`}
            title={presentation.tooltipLabel}
          >
            <span className="truncate">{presentation.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="w-72 p-layout-sm" align="start">
          <div className="space-y-layout-xs">
            <p className="text-sm font-medium text-popover-foreground">
              Version details
            </p>
            <div className="grid gap-layout-2xs text-xs">
              <VersionDetailRow
                label="Terminal"
                value={presentation.terminalVersion}
              />
              <VersionDetailRow
                label="Latest"
                value={presentation.latestVersion}
              />
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function VersionDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="font-medium uppercase text-muted-foreground">
        {label}
      </span>
      <span className="break-words text-popover-foreground">{value}</span>
    </div>
  );
}

function getRuntimeBuildVersionPresentation(
  runtimeStatus: TerminalRuntimeStatus | null,
  latestBuildMetadata: AthenaWebappRuntimeBuildMetadata | null,
): {
  label: string;
  latestVersion: string;
  status: "checking" | "latest" | "not_reported" | "stale" | "unknown";
  terminalVersion: string;
  tooltipLabel: string;
} {
  const terminalBuildMetadata = getTerminalBuildMetadata(runtimeStatus);
  const terminalVersion = formatRuntimeBuildVersion(terminalBuildMetadata);

  if (!terminalBuildMetadata.appVersion && !terminalBuildMetadata.buildSha) {
    return {
      label: "Not reported",
      latestVersion: "Not reported",
      status: "not_reported",
      terminalVersion,
      tooltipLabel:
        "Terminal version not reported. Latest version not reported.",
    };
  }

  if (latestBuildMetadata === null) {
    return {
      label: "Checking version",
      latestVersion: "Checking latest version",
      status: "checking",
      terminalVersion,
      tooltipLabel: `Terminal version: ${terminalVersion}. Latest version: checking.`,
    };
  }

  const latestVersion = formatRuntimeBuildVersion(latestBuildMetadata);
  const comparison = compareRuntimeBuildMetadata(
    terminalBuildMetadata,
    latestBuildMetadata,
  );

  if (comparison === "latest") {
    return {
      label: "Latest version",
      latestVersion,
      status: "latest",
      terminalVersion,
      tooltipLabel: `Terminal version: ${terminalVersion}. Latest version: ${latestVersion}.`,
    };
  }

  if (comparison === "stale") {
    return {
      label: "Update available",
      latestVersion,
      status: "stale",
      terminalVersion,
      tooltipLabel: `Terminal version: ${terminalVersion}. Latest version: ${latestVersion}.`,
    };
  }

  return {
    label: "Version reported",
    latestVersion,
    status: "unknown",
    terminalVersion,
    tooltipLabel: `Terminal version: ${terminalVersion}. Latest version: ${latestVersion}.`,
  };
}

function compareRuntimeBuildMetadata(
  terminalBuildMetadata: AthenaWebappRuntimeBuildMetadata,
  latestBuildMetadata: AthenaWebappRuntimeBuildMetadata,
) {
  if (
    terminalBuildMetadata.appVersion &&
    latestBuildMetadata.appVersion &&
    terminalBuildMetadata.buildSha &&
    latestBuildMetadata.buildSha
  ) {
    return terminalBuildMetadata.appVersion ===
      latestBuildMetadata.appVersion &&
      terminalBuildMetadata.buildSha === latestBuildMetadata.buildSha
      ? "latest"
      : "stale";
  }

  if (terminalBuildMetadata.buildSha && latestBuildMetadata.buildSha) {
    return terminalBuildMetadata.buildSha === latestBuildMetadata.buildSha
      ? "latest"
      : "stale";
  }

  if (terminalBuildMetadata.appVersion && latestBuildMetadata.appVersion) {
    return terminalBuildMetadata.appVersion === latestBuildMetadata.appVersion
      ? "latest"
      : "stale";
  }

  return "unknown";
}

function getTerminalBuildMetadata(
  runtimeStatus: TerminalRuntimeStatus | null,
): AthenaWebappRuntimeBuildMetadata {
  const appVersion = normalizeOptionalRuntimeMetadata(
    runtimeStatus?.appVersion,
  );
  const buildSha = normalizeOptionalRuntimeMetadata(runtimeStatus?.buildSha);

  return {
    ...(appVersion ? { appVersion } : {}),
    ...(buildSha ? { buildSha } : {}),
  };
}

function formatRuntimeBuildVersion({
  appVersion,
  buildSha,
}: AthenaWebappRuntimeBuildMetadata) {
  const shortBuildSha = buildSha?.slice(0, 12);

  if (appVersion && shortBuildSha) {
    return `${appVersion} / ${shortBuildSha}`;
  }

  return appVersion ?? shortBuildSha ?? "Not reported";
}

function normalizeOptionalRuntimeMetadata(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
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

function ConflictSection({
  detail,
  onIssueTerminalRecoveryCommand,
  operationalExplanation,
  runtimeStatus,
  syncEvidence,
}: {
  detail?: TerminalHealthDetail;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  operationalExplanation?: ReturnType<
    typeof buildTerminalOperationalExplanationPresentation
  >;
  runtimeStatus: TerminalRuntimeStatus | null;
  syncEvidence: TerminalSyncEvidence;
}) {
  const [isConflictListExpanded, setIsConflictListExpanded] = useState(false);
  const [isLocalReviewListExpanded, setIsLocalReviewListExpanded] =
    useState(false);
  const runtimeLocalReviewEvents = runtimeStatus?.sync.reviewEvents ?? [];
  const recoveryPreview = detail?.recoveryPreview ?? detail?.recovery;
  const collectedLocalReviewEvents =
    recoveryPreview?.commandStatus?.commandType === "collect_local_review" &&
    recoveryPreview.commandStatus.verificationStatus === "verified"
      ? (recoveryPreview.commandStatus.localReviewEvents ?? [])
      : [];
  const runtimeReviewCount = runtimeStatus?.sync.reviewEventCount ?? 0;
  const localReviewEvents =
    runtimeLocalReviewEvents.length > 0
      ? runtimeLocalReviewEvents
      : runtimeStatus == null || runtimeReviewCount > 0
        ? collectedLocalReviewEvents
        : [];
  const missingRuntimeReviewDetails =
    runtimeReviewCount > 0 && localReviewEvents.length === 0;
  const unresolvedConflicts = (syncEvidence.unresolvedConflicts ?? []).filter(
    (conflict) => conflict.conflictType !== "inventory",
  );
  const visibleConflicts = isConflictListExpanded
    ? unresolvedConflicts
    : unresolvedConflicts.slice(0, TERMINAL_DETAIL_LIST_VISIBLE_LIMIT);
  const hiddenConflictCount = Math.max(
    unresolvedConflicts.length - TERMINAL_DETAIL_LIST_VISIBLE_LIMIT,
    0,
  );
  const visibleLocalReviewEvents = isLocalReviewListExpanded
    ? localReviewEvents
    : localReviewEvents.slice(0, TERMINAL_DETAIL_LIST_VISIBLE_LIMIT);
  const hiddenLocalReviewCount = Math.max(
    localReviewEvents.length - TERMINAL_DETAIL_LIST_VISIBLE_LIMIT,
    0,
  );
  const reviewCount = detail && hasOnlyInventoryReviewEvidence(detail)
    ? 0
    : syncEvidence.unresolvedConflicts
      ? unresolvedConflicts.length
      : getReviewEvidenceCount(syncEvidence);
  const localReviewActionReason = {
    actionTarget: { type: "pos_register" },
    count: runtimeReviewCount,
    source: "local_runtime",
    summary: `${runtimeReviewCount} local review item${runtimeReviewCount === 1 ? " is" : "s are"} still on this terminal.`,
    type: "local_review",
  } satisfies TerminalHealthAttentionReason;
  const hasLocalReviewTableAction = Boolean(
    getAttentionReasonRecoveryAction(localReviewActionReason, detail),
  );
  const localReviewClearAllAction =
    getLocalReviewClearAllAction(recoveryPreview);

  if (
    !operationalExplanation &&
    reviewCount === 0 &&
    localReviewEvents.length === 0 &&
    !missingRuntimeReviewDetails
  ) {
    return null;
  }

  return (
    <DetailPanel
      icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      title="Conflicts and review"
    >
      <div className="space-y-layout-sm">
        {operationalExplanation ? (
          <OperationalExplanationReviewSummary
            operationalExplanation={operationalExplanation}
          />
        ) : null}

        {unresolvedConflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {reviewCount > 0
              ? `${reviewCount} sync item${reviewCount === 1 ? "" : "s"} need review; detailed conflict records were not returned.`
              : "No unresolved cloud sync conflicts are currently reported. Local runtime review, pending sync, or stale check-ins may still need attention above."}
          </p>
        ) : (
          <>
            {visibleConflicts.map((conflict) => (
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
            ))}
            {hiddenConflictCount > 0 ? (
              <Button
                className="h-8 px-layout-sm text-xs"
                onClick={() => setIsConflictListExpanded((current) => !current)}
                type="button"
                variant="outline"
              >
                {isConflictListExpanded
                  ? "Show fewer"
                  : `Show ${hiddenConflictCount} more`}
              </Button>
            ) : null}
          </>
        )}

        {localReviewEvents.length > 0 ? (
          <div className="space-y-layout-sm">
            <div className="overflow-hidden rounded-md border border-border/80 bg-surface">
              <div className="grid gap-layout-sm border-b border-border/80 bg-surface-muted/40 px-layout-md py-layout-xs text-xs font-medium uppercase text-muted-foreground md:grid-cols-[5rem_minmax(0,1fr)_8rem_7rem]">
                <span>Sequence</span>
                <span>Local review item</span>
                <span>Upload</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-border/80">
                {visibleLocalReviewEvents.map((event) => (
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
                {hiddenLocalReviewCount > 0 ? (
                  <div className="px-layout-md py-layout-sm">
                    <Button
                      className="h-8 px-layout-sm text-xs"
                      onClick={() =>
                        setIsLocalReviewListExpanded((current) => !current)
                      }
                      type="button"
                      variant="outline"
                    >
                      {isLocalReviewListExpanded
                        ? "Show fewer"
                        : `Show ${hiddenLocalReviewCount} more`}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            {hasLocalReviewTableAction ? (
              <div className="flex justify-end">
                <AttentionReasonAction
                  detail={detail}
                  onIssueTerminalRecoveryCommand={
                    onIssueTerminalRecoveryCommand
                  }
                  reason={localReviewActionReason}
                />
              </div>
            ) : null}
            {localReviewClearAllAction && detail ? (
              <LocalReviewClearAllAction
                action={localReviewClearAllAction}
                onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
                reviewCount={runtimeReviewCount}
                terminalId={detail.terminal._id}
              />
            ) : null}
          </div>
        ) : null}

        {missingRuntimeReviewDetails ? (
          <div className="grid gap-layout-sm rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {runtimeReviewCount} local review{" "}
                {runtimeReviewCount === 1 ? "item needs" : "items need"} local
                collection.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Details are missing from the latest check-in. Collect local
                review items from this checkout station.
              </p>
            </div>
            <AttentionReasonAction
              detail={detail}
              onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
              reason={{
                actionTarget: { type: "pos_register" },
                count: runtimeReviewCount,
                source: "local_runtime",
                summary: `${runtimeReviewCount} local review item${runtimeReviewCount === 1 ? " is" : "s are"} still on this terminal.`,
                type: "local_review",
              }}
            />
          </div>
        ) : null}
      </div>
    </DetailPanel>
  );
}

function LocalReviewClearAllAction({
  action,
  onIssueTerminalRecoveryCommand,
  reviewCount,
  terminalId,
}: {
  action: TerminalRecoveryAction;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  reviewCount: number;
  terminalId: Id<"posTerminal"> | string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const canIssue = isRecoveryActionIssuable(action);

  const submitClearAll = async () => {
    if (!canIssue || !onIssueTerminalRecoveryCommand || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    const result = await onIssueTerminalRecoveryCommand({ action, terminalId });
    setIsSubmitting(false);

    if (result.kind === "ok") {
      toast.success("Terminal command queued.");
      return;
    }

    const message = normalizeRecoveryActionError(result.error.message);
    setErrorMessage(message);
    toast.error(message);
  };

  return (
    <div className="grid gap-layout-sm rounded-md border border-danger/25 bg-danger/10 px-layout-md py-layout-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-layout-xs">
          <AlertTriangle className="h-4 w-4 text-danger" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            Dangerous action
          </p>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Clears all local review items reported by this terminal. Use only
          after confirming the review state is safe to discard.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {reviewCount} local review{" "}
          {reviewCount === 1 ? "item is" : "items are"} currently reported.
        </p>
        {action.status && action.status !== "available" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {getRecoveryActionStatusCopy(action)}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="mt-1 text-xs text-danger">{errorMessage}</p>
        ) : null}
      </div>
      <Button
        disabled={!canIssue || !onIssueTerminalRecoveryCommand || isSubmitting}
        onClick={() => {
          void submitClearAll();
        }}
        size="sm"
        type="button"
        variant="destructive"
      >
        <Trash2 aria-hidden="true" />
        {isSubmitting ? "Sending..." : "Clear all review items"}
      </Button>
    </div>
  );
}

function getLocalReviewClearAllAction(
  recoveryPreview: TerminalHealthDetail["recoveryPreview"] | null | undefined,
): TerminalRecoveryAction | null {
  const action = recoveryPreview?.terminalActions?.find(
    (candidate) =>
      candidate.commandType === "clear_local_review_items" &&
      isValidLocalReviewClearAllAction(candidate),
  );
  if (!action) {
    return null;
  }

  return {
    commandContext: action.commandContext,
    commandType: action.commandType,
    expectedEvidence: action.expectedEvidence,
    kind: "terminal_command",
    label: "Clear all review items",
    status: getLocalReviewClearAllStatus(recoveryPreview),
  };
}

function isValidLocalReviewClearAllAction(
  action: NonNullable<
    NonNullable<TerminalHealthDetail["recoveryPreview"]>["terminalActions"]
  >[number],
) {
  if (action.commandContext.localReviewClearAll !== true) {
    return false;
  }
  const eventIds = action.commandContext.localReviewEventIds ?? [];
  const clearedEventIds =
    action.expectedEvidence.localReviewClearedEventIds ?? [];
  return (
    eventIds.length > 0 &&
    action.commandContext.localReviewClearLimit === eventIds.length &&
    arraysEqualAsSets(eventIds, clearedEventIds)
  );
}

function arraysEqualAsSets(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return (
    leftIds.size === left.length &&
    rightIds.size === right.length &&
    left.every((id) => rightIds.has(id))
  );
}

function getLocalReviewClearAllStatus(
  recoveryPreview: TerminalHealthDetail["recoveryPreview"] | null | undefined,
) {
  const commandStatus = recoveryPreview?.commandStatus;
  if (commandStatus?.commandType !== "clear_local_review_items") {
    return "available";
  }
  if (commandStatus.verificationStatus === "verified") {
    return "verified";
  }
  if (commandStatus.verificationStatus === "runtime_verification_ready") {
    return "waiting_for_check_in";
  }
  if (
    commandStatus.status === "precondition_failed" ||
    commandStatus.status === "superseded"
  ) {
    return "failed";
  }
  return commandStatus.status ?? "available";
}

function OperationalExplanationReviewSummary({
  operationalExplanation,
}: {
  operationalExplanation: ReturnType<
    typeof buildTerminalOperationalExplanationPresentation
  >;
}) {
  return (
    <>
      <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
        <p className="text-sm font-medium text-foreground">
          {operationalExplanation.headline}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {operationalExplanation.detail}
        </p>
        <p className="mt-layout-xs text-sm text-foreground">
          <span className="font-medium">Next step:</span>{" "}
          {operationalExplanation.nextStep}
        </p>
      </div>

      {operationalExplanation.evidenceReferences.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-border/80 bg-surface">
          <div className="grid gap-layout-sm border-b border-border/80 bg-surface-muted/40 px-layout-md py-layout-xs text-xs font-medium uppercase text-muted-foreground md:grid-cols-[minmax(0,1fr)_4rem_minmax(14rem,max-content)]">
            <span>Evidence</span>
            <span>Count</span>
            <span>Type</span>
          </div>
          <div className="divide-y divide-border/80">
            {operationalExplanation.evidenceReferences.map(
              (reference, index) => (
                <div
                  className="grid gap-layout-sm px-layout-md py-layout-sm text-sm md:grid-cols-[minmax(0,1fr)_4rem_minmax(14rem,max-content)] md:items-center"
                  key={`${reference.source}-${reference.type}-${index}`}
                >
                  <span className="min-w-0 font-medium text-foreground">
                    {reference.label}
                  </span>
                  <span className="font-numeric tabular-nums text-muted-foreground">
                    {reference.count ?? "-"}
                  </span>
                  <span className="min-w-0 text-muted-foreground">
                    {formatStatusLabel(reference.type)}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No display-safe review samples were returned with this explanation.
        </p>
      )}
    </>
  );
}

function AttentionReasonsSection({
  detail,
  onIssueTerminalRecoveryCommand,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  detail: TerminalHealthDetail;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const reasons = getTerminalAttentionReasons(detail).filter(
    (reason) =>
      reason.type !== "synced_sale_inventory_review" &&
      !isVerifiedTerminalCommandAttention(reason, detail),
  );

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
                  {getTerminalCommandAttentionTitle(reason, detail) ??
                    getSupportSafeAttentionReasonSummary(reason)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {getAttentionReasonContextLabel(reason)}
                  {reason.nextPendingUploadSequence == null
                    ? ""
                    : ` / next upload #${reason.nextPendingUploadSequence}`}
                </p>
              </div>
              <AttentionReasonAction
                detail={detail}
                onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
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

function getAttentionReasonContextLabel(reason: TerminalHealthAttentionReason) {
  if (reason.type === "synced_sale_inventory_review") {
    return reason.actionTarget
      ? "Inventory review work"
      : "Inventory review required before support repair";
  }

  if (
    reason.source === "cloud_sync" &&
    (reason.type === "cloud_conflict" ||
      reason.type === "cloud_held" ||
      reason.type === "cloud_rejected") &&
    !reason.actionTarget
  ) {
    return "Manager review required before support repair";
  }

  if (reason.source === "cloud_sync") {
    return "Cloud sync evidence";
  }

  if (reason.source === "local_runtime") {
    return "Local runtime review";
  }

  return "Terminal check-in";
}

function AttentionReasonAction({
  detail,
  onIssueTerminalRecoveryCommand,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  reason,
  storeUrlSlug,
}: {
  detail?: TerminalHealthDetail;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  reason: TerminalHealthAttentionReason;
  storeUrlSlug?: string;
}) {
  const target = reason.actionTarget;
  const [isResolving, setIsResolving] = useState(false);
  const [isIssuingCommand, setIsIssuingCommand] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (!target) {
    return null;
  }

  if (target.type === "cash_control_register_session") {
    if (!orgUrlSlug || !storeUrlSlug) {
      return null;
    }
    const registerSessionId = target.registerSessionId;
    const resolveRegisterSessionReview = onResolveRegisterSessionReview;

    if (target.automaticRepairEligible && resolveRegisterSessionReview) {
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
    if (!orgUrlSlug || !storeUrlSlug) {
      return null;
    }
    return (
      <Button asChild size="sm" variant="utility">
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          search={{ o: getOrigin() }}
          to="/$orgUrlSlug/store/$storeUrlSlug/operations/open-work"
        >
          {target.label ?? "Review open work"}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  }

  if (target.type === "pos_settings") {
    return (
      <p className="max-w-sm text-xs text-muted-foreground">
        {getTerminalCommandAttentionCopy(reason, detail) ??
          "Terminal setup repair must run from this checkout station or through a terminal repair command when available."}
      </p>
    );
  }

  if (target.type === "pos_register") {
    const action = getAttentionReasonRecoveryAction(reason, detail);
    const canIssue = action ? isRecoveryActionIssuable(action) : false;

    if (action) {
      const issueRecoveryCommand = async () => {
        if (
          !canIssue ||
          !onIssueTerminalRecoveryCommand ||
          !detail ||
          isIssuingCommand
        ) {
          return;
        }

        setIsIssuingCommand(true);
        setErrorMessage("");
        const result = await onIssueTerminalRecoveryCommand({
          action,
          terminalId: detail.terminal._id,
        });
        setIsIssuingCommand(false);

        if (result.kind === "ok") {
          toast.success("Terminal command queued.");
          return;
        }

        const message = normalizeRecoveryActionError(result.error.message);
        setErrorMessage(message);
        toast.error(message);
      };

      return (
        <div className="grid justify-items-start gap-layout-xs">
          <Button
            disabled={
              !canIssue || !onIssueTerminalRecoveryCommand || isIssuingCommand
            }
            onClick={() => {
              void issueRecoveryCommand();
            }}
            size="sm"
            variant="utility"
          >
            <Send aria-hidden="true" />
            {isIssuingCommand ? "Sending..." : action.label}
          </Button>
          {action.status && action.status !== "available" ? (
            <p className="max-w-sm text-xs text-muted-foreground">
              {getRecoveryActionStatusCopy(action)}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="max-w-sm text-xs text-danger">{errorMessage}</p>
          ) : null}
        </div>
      );
    }

    return (
      <p className="max-w-sm text-xs text-muted-foreground">
        {getTerminalCommandAttentionCopy(reason, detail) ??
          "This needs a fresh check-in or terminal-side repair before support can clear it remotely."}
      </p>
    );
  }

  return null;
}

function getTerminalCommandAttentionCopy(
  reason: TerminalHealthAttentionReason,
  detail?: TerminalHealthDetail,
) {
  const expectedCommandType = getAttentionReasonCommandType(reason);
  const recovery = detail?.recovery ?? detail?.recoveryPreview ?? null;
  const commandStatus = recovery?.commandStatus;
  if (
    !expectedCommandType ||
    !commandStatus ||
    !recovery?.terminalActions?.some(
      (action) => action.commandType === expectedCommandType,
    )
  ) {
    return null;
  }

  const commandName = getTerminalCommandStatusCopyName(expectedCommandType);

  if (commandStatus.verificationStatus === "verified") {
    return `${commandName} was completed and verified by terminal check-in. This row will clear when the terminal list receives the next check-in.`;
  }
  if (
    commandStatus.status === "completed" ||
    commandStatus.verificationStatus === "runtime_verification_ready"
  ) {
    return `${commandName} completed locally. Waiting for a fresh terminal check-in to clear this attention item.`;
  }
  if (commandStatus.status === "claimed") {
    return `${commandName} is running on this checkout station.`;
  }
  if (commandStatus.status === "pending") {
    return `${commandName} is queued for this checkout station.`;
  }

  return null;
}

function isVerifiedTerminalCommandAttention(
  reason: TerminalHealthAttentionReason,
  detail?: TerminalHealthDetail,
) {
  const expectedCommandType = getAttentionReasonCommandType(reason);
  const recovery = detail?.recovery ?? detail?.recoveryPreview ?? null;
  const commandStatus = recovery?.commandStatus;

  return Boolean(
    expectedCommandType &&
    commandStatus?.verificationStatus === "verified" &&
    recovery?.terminalActions?.some(
      (action) => action.commandType === expectedCommandType,
    ),
  );
}

function getTerminalCommandAttentionTitle(
  reason: TerminalHealthAttentionReason,
  detail?: TerminalHealthDetail,
) {
  const expectedCommandType = getAttentionReasonCommandType(reason);
  const recovery = detail?.recovery ?? detail?.recoveryPreview ?? null;
  const commandStatus = recovery?.commandStatus;
  if (
    !expectedCommandType ||
    !commandStatus ||
    !recovery?.terminalActions?.some(
      (action) => action.commandType === expectedCommandType,
    )
  ) {
    return null;
  }

  const commandName = getTerminalCommandStatusCopyName(expectedCommandType);

  if (commandStatus.verificationStatus === "verified") {
    return `${commandName} verified; waiting for the next terminal check-in.`;
  }
  if (
    commandStatus.status === "completed" ||
    commandStatus.verificationStatus === "runtime_verification_ready"
  ) {
    return `${commandName} completed locally.`;
  }
  if (commandStatus.status === "claimed") {
    return `${commandName} running.`;
  }
  if (commandStatus.status === "pending") {
    return `${commandName} queued.`;
  }

  return null;
}

function getAttentionReasonCommandType(reason: TerminalHealthAttentionReason) {
  if (reason.type === "drawer_authority_blocked") {
    return "clear_stale_drawer_authority";
  }
  if (
    reason.type === "terminal_seed_missing" ||
    reason.type === "terminal_authorization_failed"
  ) {
    return "repair_terminal_seed";
  }
  if (reason.type === "sync_failed" || reason.type === "sync_unavailable") {
    return "retry_sync";
  }
  return null;
}

function getTerminalCommandStatusCopyName(
  commandType: NonNullable<ReturnType<typeof getAttentionReasonCommandType>>,
) {
  if (commandType === "clear_stale_drawer_authority") {
    return "Drawer repair command";
  }
  if (commandType === "retry_sync") {
    return "Terminal sync retry";
  }
  return "Terminal setup repair command";
}

function getAttentionReasonRecoveryAction(
  reason: TerminalHealthAttentionReason,
  detail?: TerminalHealthDetail,
) {
  if (reason.type === "local_review" && detail) {
    return (
      buildTerminalRecoveryPresentation(detail).safeActions.find(
        isLocalReviewTerminalAction,
      ) ?? null
    );
  }

  const commandType = getAttentionReasonCommandType(reason);
  if (!commandType || !detail) {
    return null;
  }

  return (
    buildTerminalRecoveryPresentation(detail).safeActions.find(
      (action) =>
        action.kind === "terminal_command" &&
        action.commandType === commandType,
    ) ?? null
  );
}

function isLocalReviewTerminalAction(action: TerminalRecoveryAction) {
  return (
    action.kind === "terminal_command" &&
    (action.commandType === "clear_local_review_items" ||
      action.commandType === "collect_local_review" ||
      (action.commandType === "retry_sync" &&
        action.commandContext?.expectedBlockerType === "local_review_replay"))
  );
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

function RecoveryNextStep({
  commandStatus,
  safeActions,
}: {
  commandStatus: ReturnType<
    typeof buildTerminalRecoveryPresentation
  >["commandStatus"];
  safeActions: TerminalRecoveryAction[];
}) {
  const nextAction = safeActions[0];
  if (!nextAction || !shouldShowRecoveryNextStep(commandStatus)) {
    return null;
  }

  return (
    <p className="mt-layout-sm rounded-md border border-warning/30 bg-warning/10 px-layout-md py-layout-sm text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Next step:</span>{" "}
      {getRecoveryNextStepCopy(nextAction)}
    </p>
  );
}

function shouldShowRecoveryNextStep(
  commandStatus: ReturnType<
    typeof buildTerminalRecoveryPresentation
  >["commandStatus"],
) {
  return (
    commandStatus.status === "Failed" ||
    commandStatus.status === "Precondition Failed" ||
    commandStatus.verificationStatus === "Verification Failed"
  );
}

function getRecoveryNextStepCopy(action: TerminalRecoveryAction) {
  if (action.commandType === "retry_sync") {
    return "retry terminal sync, then use the next check-in to decide whether drawer repair still needs to run.";
  }
  if (action.commandType === "collect_local_review") {
    return "collect local review items from this checkout station, then use the next check-in to review the terminal-local evidence.";
  }
  if (action.commandType === "clear_local_review_items") {
    return "clear reviewed local items from this checkout station, then use the next check-in to confirm the local review count is zero.";
  }
  if (action.commandType === "clear_stale_drawer_authority") {
    return "send drawer authority repair from this checkout station.";
  }
  if (action.commandType === "repair_terminal_seed") {
    return "send terminal setup repair from this checkout station.";
  }
  if (action.kind === "cloud_repair") {
    return "resolve the safe cloud repair item.";
  }
  return `run ${action.label}.`;
}

function RecoveryCommandFailureReason({
  commandStatus,
  safeActions,
}: {
  commandStatus: ReturnType<
    typeof buildTerminalRecoveryPresentation
  >["commandStatus"];
  safeActions: TerminalRecoveryAction[];
}) {
  const reason = getRecoveryCommandFailureReason(commandStatus, safeActions);
  if (!reason) return null;

  return (
    <p className="mt-layout-xs px-layout-md text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Why:</span> {reason}
    </p>
  );
}

function getRecoveryCommandFailureReason(
  commandStatus: ReturnType<
    typeof buildTerminalRecoveryPresentation
  >["commandStatus"],
  safeActions: TerminalRecoveryAction[],
) {
  if (!shouldShowRecoveryNextStep(commandStatus)) {
    return null;
  }
  if (commandStatus.latestAcknowledgement) {
    return commandStatus.latestAcknowledgement;
  }
  if (commandStatus.commandType === "clear_stale_drawer_authority") {
    if (safeActions.some((action) => action.commandType === "retry_sync")) {
      return "Drawer repair expected the stale drawer block to still be present, but terminal sync evidence changed first.";
    }
    return "Drawer repair expected the stale drawer block to still be present, but the latest terminal evidence did not match.";
  }

  return "The command evidence changed before recovery could complete.";
}

function hasCurrentSupportRecoveryWork(
  recovery: ReturnType<typeof buildTerminalRecoveryPresentation>,
) {
  return (
    recovery.safeActions.length > 0 ||
    recovery.groups.cloudRepair.length > 0 ||
    recovery.groups.terminalRequired.length > 0 ||
    recovery.groups.manualReview.length > 0 ||
    isCurrentRecoveryCommand(recovery.commandStatus)
  );
}

function isCurrentRecoveryCommand(
  commandStatus: ReturnType<
    typeof buildTerminalRecoveryPresentation
  >["commandStatus"],
) {
  if (commandStatus.verificationStatus === "Verified") {
    return false;
  }

  return ["Pending", "Claimed", "Completed"].includes(commandStatus.status);
}

function RecoveryBlockerGroup({
  blockers,
  emptyCopy,
  onIssueTerminalRecoveryCommand,
  onResolveTerminalCloudRepair,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
  terminalId,
  title,
}: {
  blockers: TerminalRecoveryPresentationBlocker[];
  emptyCopy: string;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  onResolveTerminalCloudRepair?: POSTerminalDetailViewContentProps["onResolveTerminalCloudRepair"];
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
  terminalId: Id<"posTerminal"> | string;
  title: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleLimit = 5;
  const hiddenCount = Math.max(blockers.length - visibleLimit, 0);
  const visibleBlockers = isExpanded
    ? blockers
    : blockers.slice(0, visibleLimit);

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
          <>
            {visibleBlockers.map((blocker) => (
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
                  onIssueTerminalRecoveryCommand={
                    onIssueTerminalRecoveryCommand
                  }
                  onResolveTerminalCloudRepair={onResolveTerminalCloudRepair}
                  onResolveRegisterSessionReview={
                    onResolveRegisterSessionReview
                  }
                  orgUrlSlug={orgUrlSlug}
                  storeUrlSlug={storeUrlSlug}
                  terminalId={terminalId}
                />
              </div>
            ))}
            {hiddenCount > 0 ? (
              <div className="px-layout-md py-layout-sm">
                <Button
                  className="h-8 px-layout-sm text-xs"
                  onClick={() => setIsExpanded((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  {isExpanded ? "Show fewer" : `Show ${hiddenCount} more`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function RecoveryBlockerAction({
  blocker,
  onIssueTerminalRecoveryCommand,
  onResolveTerminalCloudRepair,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
  terminalId,
}: {
  blocker: TerminalRecoveryPresentationBlocker;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  onResolveTerminalCloudRepair?: POSTerminalDetailViewContentProps["onResolveTerminalCloudRepair"];
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
  terminalId: Id<"posTerminal"> | string;
}) {
  const action = blocker.action;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (action && ["cloud_repair", "terminal_command"].includes(action.kind)) {
    const canIssue = isRecoveryActionIssuable(action);
    const handler =
      action.kind === "cloud_repair"
        ? onResolveTerminalCloudRepair
        : onIssueTerminalRecoveryCommand;

    const submitRecoveryAction = async () => {
      if (!canIssue || !handler || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      setErrorMessage("");
      const result = await handler({ action, terminalId });
      setIsSubmitting(false);

      if (result.kind === "ok") {
        toast.success(
          action.kind === "cloud_repair"
            ? "Cloud repair requested."
            : "Terminal command queued.",
        );
        return;
      }

      const message = normalizeRecoveryActionError(result.error.message);
      setErrorMessage(message);
      toast.error(message);
    };

    return (
      <div className="grid justify-items-start gap-layout-xs">
        <Button
          disabled={!canIssue || !handler || isSubmitting}
          onClick={() => {
            void submitRecoveryAction();
          }}
          size="sm"
          variant="utility"
        >
          {action.kind === "terminal_command" ? (
            <Send aria-hidden="true" />
          ) : (
            <Wrench aria-hidden="true" />
          )}
          {isSubmitting ? "Sending..." : action.label}
        </Button>
        {action.status && action.status !== "available" ? (
          <p className="max-w-sm text-xs text-muted-foreground">
            {getRecoveryActionStatusCopy(action)}
          </p>
        ) : null}
        {action.latestAcknowledgement ? (
          <p className="max-w-sm text-xs text-muted-foreground">
            {action.latestAcknowledgement}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="max-w-sm text-xs text-danger">{errorMessage}</p>
        ) : null}
      </div>
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

function getRecoveryActionStatusCopy(action: TerminalRecoveryAction) {
  if (action.commandType === "update_app") {
    switch (action.status) {
      case "pending":
        return "Update app command is queued for this checkout station.";
      case "claimed":
        return "Update app command is running on this checkout station.";
      case "completed":
      case "waiting_for_check_in":
        return "Update app command completed locally. Waiting for a fresh check-in.";
      case "verified":
        return "App update verified by the latest terminal check-in.";
      case "expired":
        return "Update app command expired. Refresh terminal health before sending another command.";
      case "failed":
        return "Update app command did not complete. Refresh terminal health before retrying.";
      case "blocked":
        return "Update app command is blocked by current terminal evidence.";
    }
  }

  switch (action.status) {
    case "pending":
      return "Command is queued for this checkout station.";
    case "claimed":
      return "Command is running on this checkout station.";
    case "completed":
    case "waiting_for_check_in":
      return "Command completed locally. Waiting for a fresh check-in before verification.";
    case "verified":
      return "Recovery verified by the latest terminal check-in.";
    case "expired":
      return "Command expired. Refresh terminal health before sending another command.";
    case "failed":
      if (action.commandType === "clear_stale_drawer_authority") {
        return "Command did not complete. Use the available terminal action before sending drawer repair again.";
      }
      return "Command did not complete. Run the next safe action before retrying.";
    case "blocked":
      return "Recovery is blocked by current terminal evidence.";
    default:
      return formatStatusLabel(action.status);
  }
}

function normalizeRecoveryActionError(message?: string) {
  if (!message) {
    return "Recovery action could not be sent. Refresh terminal health and try again.";
  }
  if (/authorization|access/i.test(message)) {
    return "Support permission is required before sending this recovery action.";
  }
  if (/precondition|changed/i.test(message)) {
    return "Terminal recovery evidence changed. Refresh terminal health before retrying.";
  }
  return message;
}

function AppUpdateActionPanel({
  appUpdate,
  onIssueTerminalRecoveryCommand,
  terminalId,
}: {
  appUpdate: ReturnType<typeof buildTerminalRecoveryPresentation>["appUpdate"];
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  terminalId: Id<"posTerminal"> | string;
}) {
  const action = appUpdate.action;
  const canIssue = action ? isRecoveryActionIssuable(action) : false;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submitUpdateApp = async () => {
    if (
      !action ||
      !canIssue ||
      !onIssueTerminalRecoveryCommand ||
      isSubmitting
    ) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    const result = await onIssueTerminalRecoveryCommand({ action, terminalId });
    setIsSubmitting(false);

    if (result.kind === "ok") {
      toast.success("Update app command queued.");
      return;
    }

    const message = normalizeRecoveryActionError(result.error.message);
    setErrorMessage(message);
    toast.error(message);
  };

  return (
    <div className="mt-layout-md rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
      <div className="grid gap-layout-md md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            App update
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-layout-xs">
            <p className="text-base font-medium text-foreground">
              {appUpdate.label}
            </p>
            <Badge className={appUpdate.toneClassName} variant="outline">
              {formatStatusLabel(appUpdate.status)}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {appUpdate.description}
          </p>
          {action?.status && action.status !== "available" ? (
            <p
              className="mt-layout-xs text-xs text-muted-foreground"
              role="status"
            >
              {getRecoveryActionStatusCopy(action)}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="mt-layout-xs text-xs text-danger">{errorMessage}</p>
          ) : null}
        </div>
        <Button
          disabled={
            !action ||
            !canIssue ||
            !onIssueTerminalRecoveryCommand ||
            isSubmitting
          }
          onClick={() => {
            void submitUpdateApp();
          }}
          size="sm"
          variant="utility"
        >
          <MonitorUp aria-hidden="true" />
          {isSubmitting ? "Sending..." : "Update app"}
        </Button>
      </div>
    </div>
  );
}

function RecoveryPanel({
  detail,
  onIssueTerminalRecoveryCommand,
  onResolveTerminalCloudRepair,
  onResolveRegisterSessionReview,
  orgUrlSlug,
  storeUrlSlug,
}: {
  detail: TerminalHealthDetail;
  onIssueTerminalRecoveryCommand?: POSTerminalDetailViewContentProps["onIssueTerminalRecoveryCommand"];
  onResolveTerminalCloudRepair?: POSTerminalDetailViewContentProps["onResolveTerminalCloudRepair"];
  onResolveRegisterSessionReview?: POSTerminalDetailViewContentProps["onResolveRegisterSessionReview"];
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const recovery = buildTerminalRecoveryPresentation(detail);
  const operationalExplanation =
    buildTerminalOperationalExplanationPresentation(detail);
  const hasServerOperationalExplanation = Boolean(
    detail.operationalExplanation &&
      !shouldSuppressInventoryOperationalExplanation(detail),
  );
  const hasCurrentRecoveryWork = hasCurrentSupportRecoveryWork(recovery);
  const supportReadiness = hasCurrentRecoveryWork
    ? recovery.readiness
    : {
        description:
          "Current terminal evidence has no repair or review blockers.",
        label: "No support action needed",
      };

  return (
    <DetailPanel
      icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
      title="Support recovery"
    >
      <div className="rounded-md border border-border/80 bg-surface px-layout-md py-layout-md">
        <div className="flex flex-col gap-layout-sm md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              {hasServerOperationalExplanation
                ? "Operational explanation"
                : "Readiness"}
            </p>
            <p className="mt-1 text-base font-medium text-foreground">
              {hasServerOperationalExplanation
                ? operationalExplanation.headline
                : supportReadiness.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasServerOperationalExplanation
                ? operationalExplanation.detail
                : supportReadiness.description}
            </p>
            {hasServerOperationalExplanation ? (
              <p className="mt-layout-xs text-sm text-foreground">
                <span className="font-medium">Next step:</span>{" "}
                {operationalExplanation.nextStep}
              </p>
            ) : null}
          </div>
          {hasServerOperationalExplanation ? (
            <Badge
              className={operationalExplanation.toneClassName}
              variant="outline"
            >
              {operationalExplanation.saleImpactLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      {hasServerOperationalExplanation ? (
        <div className="mt-layout-md grid gap-layout-sm md:grid-cols-3">
          <RecoveryMetric
            label="Owner"
            value={operationalExplanation.ownerLabel}
          />
          <RecoveryMetric
            label="Support action"
            value={operationalExplanation.supportActionLabel}
          />
          <RecoveryMetric
            label="Recovery readiness"
            value={supportReadiness.label}
          />
        </div>
      ) : null}

      <AppUpdateActionPanel
        appUpdate={recovery.appUpdate}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
        terminalId={detail.terminal._id}
      />

      {hasCurrentRecoveryWork ? (
        <>
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
          <RecoveryNextStep
            commandStatus={recovery.commandStatus}
            safeActions={recovery.safeActions}
          />
          <RecoveryCommandFailureReason
            commandStatus={recovery.commandStatus}
            safeActions={recovery.safeActions}
          />

          <div className="mt-layout-md space-y-layout-sm">
            <RecoveryBlockerGroup
              blockers={recovery.groups.cloudRepair}
              emptyCopy="No cloud-safe repair blockers are reported."
              onResolveTerminalCloudRepair={onResolveTerminalCloudRepair}
              onResolveRegisterSessionReview={onResolveRegisterSessionReview}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
              terminalId={detail.terminal._id}
              title="Cloud repair"
            />
            <RecoveryBlockerGroup
              blockers={recovery.groups.terminalRequired}
              emptyCopy="No terminal-required blockers are reported."
              onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
              onResolveRegisterSessionReview={onResolveRegisterSessionReview}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
              terminalId={detail.terminal._id}
              title="Terminal required"
            />
            <RecoveryBlockerGroup
              blockers={recovery.groups.manualReview}
              emptyCopy="No manual-review blockers are reported."
              onResolveRegisterSessionReview={onResolveRegisterSessionReview}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
              terminalId={detail.terminal._id}
              title="Manual review"
            />
          </div>

          <p className="mt-layout-md text-sm text-muted-foreground">
            {recovery.verification.summary}
          </p>
        </>
      ) : null}
    </DetailPanel>
  );
}

function hasOnlyInventoryReviewEvidence(detail: TerminalHealthDetail) {
  const recoveryPreview = detail.recoveryPreview ?? detail.recovery;
  const conflicts = detail.syncEvidence.unresolvedConflicts ?? [];
  const manualReview = recoveryPreview?.manualReview ?? [];
  const explanationReferences =
    detail.operationalExplanation?.evidenceReferences ?? [];
  const hasInventoryReviewEvidence =
    conflicts.some((conflict) => conflict.conflictType === "inventory") ||
    manualReview.some(
      (item) => item.type === "synced_sale_inventory_review",
    ) ||
    explanationReferences.some(
      (reference) => reference.type === "synced_sale_inventory_review",
    );
  const terminalReviewEvidenceTypes = new Set([
    "cloud_conflict",
    "cloud_held",
    "cloud_rejected",
    "local_review",
    "unsafe_cloud_conflict",
  ]);
  const hasTerminalReviewEvidence =
    conflicts.some((conflict) => conflict.conflictType !== "inventory") ||
    manualReview.some(
      (item) => item.type !== "synced_sale_inventory_review",
    ) ||
    explanationReferences.some((reference) =>
      terminalReviewEvidenceTypes.has(reference.type),
    );

  return hasInventoryReviewEvidence && !hasTerminalReviewEvidence;
}

function shouldSuppressInventoryOperationalExplanation(
  detail: TerminalHealthDetail,
) {
  const blockingDomain = detail.operationalExplanation?.blockingDomain;
  return (
    (blockingDomain === "manual_review" || blockingDomain === "sync_review") &&
    hasOnlyInventoryReviewEvidence(detail)
  );
}

function RemoteAssistPanel({
  canStartRemoteAssist = false,
  client,
  detail,
  onEndRemoteAssist,
  onStartRemoteAssist,
  session,
}: {
  canStartRemoteAssist?: boolean;
  client?: RemoteAssistClientSummary | null;
  detail: TerminalHealthDetail;
  onEndRemoteAssist?: POSTerminalDetailViewContentProps["onEndRemoteAssist"];
  onStartRemoteAssist?: POSTerminalDetailViewContentProps["onStartRemoteAssist"];
  session?: RemoteAssistSessionSummary | null;
}) {
  const [reason, setReason] = useState("");
  const [isEnding, setIsEnding] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timerId);
  }, []);
  const presenceFresh = isRemoteAssistPresenceFresh(client, now);
  const available =
    canStartRemoteAssist &&
    client?.enrollmentStatus === "active" &&
    client?.accessPolicy === "unattended_allowed" &&
    client?.presenceStatus === "online" &&
    presenceFresh;
  const availabilityCopy = getRemoteAssistAvailabilityCopy(
    client,
    presenceFresh,
    canStartRemoteAssist,
  );
  const hasCurrentSession = Boolean(
    session && isRemoteAssistSessionCurrent(session),
  );

  async function handleStartRemoteAssist() {
    if (!client || !onStartRemoteAssist || !available) {
      return;
    }
    setIsStarting(true);
    try {
      const result = await onStartRemoteAssist({
        clientId: client._id,
        reason: reason.trim(),
      });
      if (result.kind === "ok") {
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

  async function handleEndRemoteAssist() {
    if (
      !session ||
      !onEndRemoteAssist ||
      !isRemoteAssistSessionCurrent(session)
    ) {
      return;
    }
    setIsEnding(true);
    try {
      const result = await onEndRemoteAssist({
        reason: "Support ended the Remote Assist session.",
        sessionId: session._id,
      });
      if (result.kind === "ok") {
        toast.success("Remote Assist session ended.");
      } else {
        toast.error(result.error.message);
      }
    } catch {
      toast.error("Remote Assist could not end right now.");
    } finally {
      setIsEnding(false);
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

      {session ? (
        <div
          className={cn(
            "mt-layout-md rounded-md border px-layout-md py-layout-md",
            session.status === "active"
              ? "border-success/25 bg-success/5"
              : isRemoteAssistSessionCurrent(session)
                ? "border-info/30 bg-info/10"
                : "border-border/80 bg-surface",
          )}
        >
          <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Session
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {getRemoteAssistSessionStatusLabel(session.status)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {getRemoteAssistSessionStatusDescription(session)}
              </p>
            </div>
            {isRemoteAssistSessionCurrent(session) ? (
              <Button
                disabled={isEnding}
                onClick={handleEndRemoteAssist}
                size="sm"
                type="button"
                variant="outline"
              >
                {isEnding ? "Ending" : "End session"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {session && isRemoteAssistSessionCurrent(session) ? (
        <RemoteAssistSupportConsole
          controlEnabled={
            session.status === "active" &&
            session.effectiveMode === "unattended" &&
            !session.sensitiveModeActive
          }
          enabled={
            session.status === "active" || session.status === "connecting"
          }
          onEndSession={() => {
            void handleEndRemoteAssist();
          }}
          sessionId={session._id}
        />
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
          placeholder="Describe the support task for this terminal."
          value={reason}
        />
        <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Remote Assist operates this Athena surface only; POS authority and
            recovery gates still apply.
          </p>
          <Button
            disabled={
              !available || !reason.trim() || isStarting || hasCurrentSession
            }
            onClick={handleStartRemoteAssist}
            type="button"
            variant="workflow"
          >
            <MonitorUp aria-hidden="true" className="mr-2 h-4 w-4" />
            {isStarting ? "Starting" : "Start session"}
          </Button>
        </div>
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

function isRemoteAssistSessionCurrent(session: RemoteAssistSessionSummary) {
  return ["active", "connecting", "pending_attended_approval"].includes(
    session.status,
  );
}

function getRemoteAssistSessionStatusLabel(status: string) {
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
    case "denied":
      return "Remote Assist session denied";
    default:
      return formatStatusLabel(status);
  }
}

function getRemoteAssistSessionStatusDescription(
  session: RemoteAssistSessionSummary,
) {
  switch (session.status) {
    case "active":
      return "The terminal runtime has joined. Support controls stay inside Athena and POS authority gates still apply.";
    case "connecting":
      return "Support request accepted. The terminal runtime still needs to join before live assist controls are available.";
    case "pending_attended_approval":
      return "A local operator must approve before support can connect.";
    case "ended":
      return (
        session.terminationReason ?? "Support ended this Remote Assist session."
      );
    case "expired":
      return "This support request expired before it was completed.";
    default:
      return "Remote Assist session state is recorded for this terminal.";
  }
}

export function POSTerminalDetailViewContent({
  canStartRemoteAssist = false,
  detail,
  isLoading,
  onDisconnectTerminal,
  onEndRemoteAssist,
  onIssueTerminalRecoveryCommand,
  onResolveTerminalCloudRepair,
  onResolveRegisterSessionReview,
  onSetTerminalHeartbeat,
  onStartRemoteAssist,
  orgUrlSlug,
  queryUnavailable = false,
  remoteAssistClient,
  remoteAssistSession,
  storeName,
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
            description="Inspect the latest terminal check-in, support recovery evidence, and support notes."
          />

          <div className="grid gap-layout-xl xl:grid-cols-[20rem_minmax(0,1fr)]">
            <TerminalContextRail
              classification={classification}
              detail={detail}
              onSetTerminalHeartbeat={onSetTerminalHeartbeat}
              runtimeStatus={runtimeStatus}
            />

            <main className="space-y-layout-lg">
              <RemoteAssistPanel
                canStartRemoteAssist={canStartRemoteAssist}
                client={remoteAssistClient}
                detail={detail}
                onEndRemoteAssist={onEndRemoteAssist}
                onStartRemoteAssist={onStartRemoteAssist}
                session={remoteAssistSession}
              />
              <RecoveryPanel
                detail={detail}
                onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
                onResolveTerminalCloudRepair={onResolveTerminalCloudRepair}
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
              <AttentionReasonsSection
                detail={detail}
                onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
                onResolveRegisterSessionReview={onResolveRegisterSessionReview}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
              <ConflictSection
                detail={detail}
                onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
                operationalExplanation={
                  detail.operationalExplanation &&
                  !shouldSuppressInventoryOperationalExplanation(detail)
                    ? buildTerminalOperationalExplanationPresentation(detail)
                    : undefined
                }
                runtimeStatus={detail.runtimeStatus}
                syncEvidence={detail.syncEvidence}
              />
              <SupportNotesSection runtimeStatus={runtimeStatus} />
              <DisconnectTerminalPanel
                detail={detail}
                onDisconnectTerminal={onDisconnectTerminal}
                storeName={storeName ?? storeUrlSlug ?? "the selected store"}
              />
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
  const demoContext = useSharedDemoContext();
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
  const canManageTerminalHealth = hasFullAdminAccess && !demoContext;
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
    canQuery && !demoContext && activeStore?.organizationId
      ? {
          organizationId: activeStore.organizationId as Id<"organization">,
          runtimeIdentity: params!.terminalId as string,
          runtimeType: "pos_terminal",
        }
      : "skip",
  ) as RemoteAssistClientSummary | null | undefined;
  const remoteAssistSession = useQuery(
    remoteAssistApi.getCurrentSessionByClient,
    canManageTerminalHealth && remoteAssistClient?._id
      ? {
          clientId: remoteAssistClient._id as Id<"remoteAssistClient">,
        }
      : "skip",
  ) as RemoteAssistSessionSummary | null | undefined;
  const resolveRegisterSessionSyncReview = useMutation(
    api.cashControls.deposits.resolveRegisterSessionSyncReview,
  );
  const resolveTerminalCloudRepair = useMutation(
    api.pos.public.terminals.resolveTerminalCloudRepair,
  );
  const issueTerminalRecoveryCommand = useMutation(
    api.pos.public.terminals.issueTerminalRecoveryCommand,
  );
  const disconnectTerminal = useMutation(
    api.pos.public.terminals.disconnectTerminal,
  );
  const updateTerminal = useMutation(api.pos.public.terminals.updateTerminal);
  const startRemoteAssistSession = useMutation(remoteAssistApi.startSession);
  const endRemoteAssistSession = useMutation(remoteAssistApi.endSupportSession);

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

  async function onResolveTerminalCloudRepair({
    action,
    terminalId,
  }: {
    action: TerminalRecoveryAction;
    terminalId: Id<"posTerminal"> | string;
  }): Promise<TerminalRecoveryMutationResult> {
    if (!activeStore?._id || !action.expectedPreconditionHash) {
      return {
        kind: "user_error",
        error: {
          message:
            "Terminal recovery evidence changed. Refresh terminal health before retrying.",
        },
      };
    }

    return runCommand(() =>
      resolveTerminalCloudRepair({
        expectedPreconditionHash: action.expectedPreconditionHash!,
        storeId: activeStore._id,
        terminalId: terminalId as Id<"posTerminal">,
      }),
    ) as Promise<TerminalRecoveryMutationResult>;
  }

  async function onIssueTerminalRecoveryCommand({
    action,
    terminalId,
  }: {
    action: TerminalRecoveryAction;
    terminalId: Id<"posTerminal"> | string;
  }): Promise<TerminalRecoveryMutationResult> {
    if (
      !activeStore?._id ||
      !action.commandType ||
      !action.commandContext ||
      !action.expectedEvidence
    ) {
      return {
        kind: "user_error",
        error: {
          message:
            "Terminal recovery evidence changed. Refresh terminal health before retrying.",
        },
      };
    }

    return runCommand(() =>
      issueTerminalRecoveryCommand({
        commandContext: action.commandContext!,
        commandType: action.commandType!,
        expectedEvidence: action.expectedEvidence!,
        storeId: activeStore._id,
        terminalId: terminalId as Id<"posTerminal">,
      }),
    ) as Promise<TerminalRecoveryMutationResult>;
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

  async function onEndRemoteAssist({
    reason,
    sessionId,
  }: {
    reason: string;
    sessionId: Id<"remoteAssistSession"> | string;
  }): Promise<RemoteAssistEndResult> {
    return endRemoteAssistSession({
      reason,
      sessionId: sessionId as Id<"remoteAssistSession">,
    }) as Promise<RemoteAssistEndResult>;
  }

  async function onSetTerminalHeartbeat({
    heartbeatEnabled,
    terminalId,
  }: {
    heartbeatEnabled: boolean;
    terminalId: Id<"posTerminal"> | string;
  }): Promise<void> {
    await updateTerminal({
      heartbeatEnabled,
      terminalId: terminalId as Id<"posTerminal">,
    });
  }

  async function onDisconnectTerminal({
    terminalId,
  }: {
    terminalId: Id<"posTerminal"> | string;
  }): Promise<void> {
    await disconnectTerminal({
      terminalId: terminalId as Id<"posTerminal">,
    });
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
      canStartRemoteAssist={canManageTerminalHealth}
      isLoading={detail === undefined}
      onDisconnectTerminal={
        canManageTerminalHealth ? onDisconnectTerminal : undefined
      }
      onIssueTerminalRecoveryCommand={
        canManageTerminalHealth ? onIssueTerminalRecoveryCommand : undefined
      }
      onResolveTerminalCloudRepair={
        canManageTerminalHealth ? onResolveTerminalCloudRepair : undefined
      }
      onResolveRegisterSessionReview={
        canManageTerminalHealth ? onResolveRegisterSessionReview : undefined
      }
      onSetTerminalHeartbeat={
        canManageTerminalHealth ? onSetTerminalHeartbeat : undefined
      }
      onEndRemoteAssist={
        canManageTerminalHealth ? onEndRemoteAssist : undefined
      }
      onStartRemoteAssist={
        canManageTerminalHealth ? onStartRemoteAssist : undefined
      }
      orgUrlSlug={params.orgUrlSlug}
      queryUnavailable={detail === null && !params.terminalId}
      remoteAssistClient={remoteAssistClient ?? null}
      remoteAssistSession={remoteAssistSession ?? null}
      storeName={activeStore.name}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}

export default POSTerminalDetailView;
