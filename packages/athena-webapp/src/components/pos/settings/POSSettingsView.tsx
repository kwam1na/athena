import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { ArrowUpRight } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FadeIn } from "../../common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "../../common/PageLevelHeader";
import View from "../../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  BrowserFingerprintResult,
  generateBrowserFingerprint,
} from "@/lib/browserFingerprint";
import { toast } from "sonner";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import {
  registerAndProvisionPosTerminal,
  type ProvisionedTerminalRecord,
} from "@/lib/pos/application/registerAndProvisionPosTerminal";
import { usePermissions } from "@/hooks/usePermissions";
import {
  isSharedDemoUiEnabled,
  useSharedDemoContext,
} from "@/hooks/useSharedDemoContext";
import {
  buildPosOfflineReadinessSummary,
  type PosOfflineReadinessInput,
  type PosOfflineReadinessSummary,
} from "@/offline/posOfflineReadiness";
import { readPosAppShellReadiness } from "@/offline/posAppShellReadiness";
import {
  getDefaultPosLocalStore,
  requestDefaultPosLocalPersistentStorage,
} from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";
import {
  DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY,
  normalizePosTerminalTransactionCapability,
  type PosTerminalTransactionCapability,
} from "~/shared/posTerminalCapability";
import {
  DEFAULT_POS_TERMINAL_LOGIN_MODE,
  normalizePosTerminalLoginMode,
  type PosTerminalLoginMode,
} from "~/shared/posTerminalLoginMode";
import { usePosTerminalAppSessionRecoveryRuntimeInput } from "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext";
import type { PosTerminalRuntimeAppSessionRecoveryInput } from "@/lib/pos/infrastructure/local/terminalRuntimeStatus";
import { getOrigin } from "@/lib/navigationUtils";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import { toDisplayAmount } from "~/convex/lib/currency";
import { currencyDisplaySymbol } from "~/shared/currencyFormatter";

type HealthLinkProps = {
  children: ReactNode;
  className?: string;
  params: {
    orgUrlSlug: string;
    storeUrlSlug: string;
    terminalId?: string;
  };
  search?: { o: string };
  to: string;
};

const HealthLink = Link as unknown as ComponentType<HealthLinkProps>;
type AutomationPolicyMode = "disabled" | "dry_run" | "enabled";
const DEFAULT_OPENING_LOCAL_START_MINUTES = 8 * 60;
const DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES = 22 * 60;
const AUTOMATION_START_OFFSET_OPTIONS = [
  { value: "-60", label: "1 hour before opening" },
  { value: "-30", label: "30 minutes before opening" },
  { value: "-15", label: "15 minutes before opening" },
  { value: "0", label: "At opening" },
  { value: "15", label: "15 minutes after opening" },
  { value: "30", label: "30 minutes after opening" },
  { value: "60", label: "1 hour after opening" },
];
const EOD_COMPLETION_OFFSET_OPTIONS = [
  { value: "0", label: "At close" },
  { value: "15", label: "15 minutes after close" },
  { value: "30", label: "30 minutes after close" },
  { value: "60", label: "1 hour after close" },
  { value: "120", label: "2 hours after close" },
  { value: "180", label: "3 hours after close" },
];
const terminalCapabilityOptions: Array<{
  value: PosTerminalTransactionCapability;
  label: string;
  description: string;
}> = [
    {
      value: "products_and_services",
      label: "Product SKUs and services",
      description: "Use this register for retail items and service work.",
    },
    {
      value: "products_only",
      label: "Product SKUs only",
      description: "Use this register for retail items only.",
    },
    {
      value: "services_only",
      label: "Services only",
      description: "Use this register for service work only.",
    },
  ];
const terminalLoginModeOptions: Array<{
  value: PosTerminalLoginMode;
  label: string;
  description: string;
}> = [
    {
      value: "standard",
      label: "Standard login",
      description: "Show email code first. POS sign in stays available.",
    },
    {
      value: "pos_only",
      label: "POS only",
      description: "Show POS sign in first. Email code remains secondary.",
    },
  ];

type FingerprintRegistrationCardProps = {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  registerNumber: string;
  onRegisterNumberChange: (value: string) => void;
  transactionCapability: PosTerminalTransactionCapability;
  onTransactionCapabilityChange: (
    value: PosTerminalTransactionCapability,
  ) => void;
  loginMode: PosTerminalLoginMode;
  onLoginModeChange: (value: PosTerminalLoginMode) => void;
  canRegister: boolean;
  onRegister: () => void;
  isRegistering: boolean;
  isExistingTerminal: boolean;
  isRegisterNumberLocked: boolean;
  canUpdateExisting: boolean;
  onUpdateExisting: () => void;
  isUpdatingExisting: boolean;
  fingerprintError: string | null;
  existingTerminalName?: string | null;
  existingTerminalRegisterNumber?: string | null;
  offlineReadiness: PosOfflineReadinessSummary;
  readOnly?: boolean;
};

function FingerprintRegistrationCard({
  displayName,
  onDisplayNameChange,
  registerNumber,
  onRegisterNumberChange,
  transactionCapability,
  onTransactionCapabilityChange,
  loginMode,
  onLoginModeChange,
  canRegister,
  onRegister,
  isRegistering,
  isExistingTerminal,
  isRegisterNumberLocked,
  canUpdateExisting,
  onUpdateExisting,
  isUpdatingExisting,
  fingerprintError,
  existingTerminalName,
  existingTerminalRegisterNumber,
  offlineReadiness,
  readOnly = false,
}: FingerprintRegistrationCardProps) {
  const terminalStatusLabel = fingerprintError
    ? "Needs attention"
    : isExistingTerminal
      ? "Ready"
      : "Setup needed";
  const primaryActionLabel = isExistingTerminal
    ? "Save terminal settings"
    : "Register terminal";

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">Register setup</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Name this checkout station and assign the register number the team
          uses for cash drawer work.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {terminalStatusLabel}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {existingTerminalName ?? "No register name"}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {existingTerminalRegisterNumber
              ? `Register ${existingTerminalRegisterNumber}`
              : "Register number needed"}
          </span>
        </div>

        <div className="flex gap-4">
          <div className="space-y-layout-xs">
            <Label htmlFor="terminal-name">Terminal name</Label>
            <Input
              id="terminal-name"
              placeholder="Front Counter Terminal"
              className="h-control-standard bg-background"
              value={displayName}
              readOnly={readOnly}
              onChange={(event) => onDisplayNameChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use a name your team recognizes at the counter.
            </p>
          </div>

          <div className="space-y-layout-xs">
            <Label htmlFor="terminal-register-number">Register number</Label>
            <Input
              id="terminal-register-number"
              placeholder="1"
              className="h-control-standard bg-background"
              value={registerNumber}
              disabled={isExistingTerminal && isRegisterNumberLocked}
              readOnly={readOnly}
              onChange={(event) => onRegisterNumberChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isExistingTerminal && isRegisterNumberLocked
                ? "Registered terminals keep their original register number"
                : "Use the number printed on the drawer or assigned by the manager"}
            </p>
          </div>
        </div>

        <div className="space-y-layout-xs">
          <Label>Terminal can transact</Label>
          <RadioGroup
            className="grid gap-layout-sm sm:grid-cols-3"
            value={transactionCapability}
            onValueChange={(value) =>
              onTransactionCapabilityChange(
                normalizePosTerminalTransactionCapability(value),
              )
            }
          >
            {terminalCapabilityOptions.map((option) => (
              <label
                className="flex min-h-[6.5rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-action-neutral-soft"
                key={option.value}
              >
                <span className="flex items-start gap-layout-xs">
                  <RadioGroupItem
                    aria-label={option.label}
                    disabled={readOnly}
                    value={option.value}
                  />
                  <span className="font-medium text-foreground">
                    {option.label}
                  </span>
                </span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-layout-xs">
          <Label>Terminal login</Label>
          <RadioGroup
            className="grid w-fit max-w-full gap-layout-sm sm:grid-cols-[repeat(2,minmax(0,20rem))]"
            value={loginMode}
            onValueChange={(value) =>
              onLoginModeChange(normalizePosTerminalLoginMode(value))
            }
          >
            {terminalLoginModeOptions.map((option) => (
              <label
                className="flex min-h-[5.75rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-action-neutral-soft"
                key={option.value}
              >
                <span className="flex items-start gap-layout-xs">
                  <RadioGroupItem
                    aria-label={option.label}
                    disabled={readOnly}
                    value={option.value}
                  />
                  <span className="font-medium text-foreground">
                    {option.label}
                  </span>
                </span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>

        {fingerprintError ? (
          <div
            className="rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
            role="alert"
          >
            {fingerprintError}
          </div>
        ) : null}

        <div className="border-t border-border pt-layout-md">
          <p className="pb-layout-md text-sm text-muted-foreground">
            {existingTerminalRegisterNumber
              ? "This register is ready for checkout"
              : "Register number required before checkout can start here"}
          </p>

          {isExistingTerminal && isRegisterNumberLocked ? (
            <LoadingButton
              onClick={onUpdateExisting}
              isLoading={isUpdatingExisting}
              disabled={readOnly || !canUpdateExisting || isUpdatingExisting}
              variant="primary-soft"
            >
              Save terminal settings
            </LoadingButton>
          ) : (
            <LoadingButton
              onClick={onRegister}
              isLoading={isRegistering}
              disabled={readOnly || !canRegister || isRegistering}
              variant="primary-soft"
            >
              {primaryActionLabel}
            </LoadingButton>
          )}
        </div>

        <div className="border-t border-border pt-layout-md">
          <div className="flex flex-wrap items-center justify-between gap-layout-sm">
            <div>
              <p className="text-sm font-medium text-foreground">
                {offlineReadiness.title}
              </p>
              <p className="mt-layout-2xs text-sm text-muted-foreground">
                {offlineReadiness.description}
              </p>
            </div>
            <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
              {offlineReadiness.readyCount} of {offlineReadiness.signals.length}{" "}
              reporting
            </span>
          </div>

          <dl className="mt-layout-md grid gap-layout-sm sm:grid-cols-2">
            {offlineReadiness.signals.map((signal) => (
              <div
                className="rounded-md border border-border bg-background px-layout-sm py-layout-xs"
                key={signal.domain}
              >
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  {signal.label}
                </dt>
                <dd className="mt-layout-2xs text-sm text-foreground">
                  {signal.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function formatRecoveryTimestamp(value?: number | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type StoreDayAutomationPolicy = {
  localStartMinutes?: number | null;
  mode?: AutomationPolicyMode | null;
  openingBlockerHandling?:
  "skip_when_blocked" | "start_with_manager_review" | null;
  operatingTimezoneOffsetMinutes?: number | null;
};

type EodAutoCompletePolicy = {
  cleanDayAutoCompleteEnabled?: boolean | null;
  localCompletionWindowMinutes?: number | null;
  maxAbsoluteCashVariance?: number | null;
  maxVoidedSaleCount?: number | null;
  maxVoidedSaleTotal?: number | null;
  mode?: AutomationPolicyMode | null;
  operatingTimezoneOffsetMinutes?: number | null;
};

type RegisterCloseoutApprovalPolicy = {
  requireManagerSignoffForAnyVariance?: boolean | null;
  requireManagerSignoffForOvers?: boolean | null;
  requireManagerSignoffForShorts?: boolean | null;
  varianceApprovalThreshold?: number | null;
};

type UpdateEodAutoCompletePolicy = (args: {
  cleanDayAutoCompleteEnabled: boolean;
  localCompletionWindowMinutes: number;
  maxAbsoluteCashVariance: number;
  maxVoidedSaleCount: number;
  maxVoidedSaleTotal: number;
  mode: AutomationPolicyMode;
  operatingTimezoneOffsetMinutes?: number;
  storeId: Id<"store">;
}) => Promise<unknown>;

type UpdateRegisterCloseoutApprovalPolicy = (args: {
  storeId: Id<"store">;
  varianceApprovalThreshold: number;
}) => Promise<unknown>;

type UpdateOpeningAutoStartPolicy = (args: {
  localStartMinutes: number;
  mode: Extract<AutomationPolicyMode, "disabled" | "enabled">;
  openingBlockerHandling: "start_with_manager_review";
  operatingTimezoneOffsetMinutes?: number;
  storeId: Id<"store">;
}) => Promise<unknown>;

function normalizeAutomationPolicyMode(
  value?: AutomationPolicyMode | null,
): AutomationPolicyMode {
  return value === "enabled" || value === "dry_run" ? value : "disabled";
}

function parseNonNegativeIntegerInput(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeMoneyInput(value: string) {
  const parsed = parseDisplayAmountInput(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : null;
}

function formatMinorUnitInputValue(value?: number | null) {
  return String(toDisplayAmount(value ?? 0));
}

function normalizeMinuteOfDay(value: number) {
  return ((value % (24 * 60)) + 24 * 60) % (24 * 60);
}

function parseStoreHoursTimeLabel(value?: string | null) {
  if (!value) return null;

  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12;
    if (meridiem === "PM") hour += 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

function formatStoreHoursTimeLabel(value?: string | null) {
  const minutes = parseStoreHoursTimeLabel(value);
  if (minutes === null) return value ?? "Store Hours opening time";

  return formatMinuteOfDayLabel(minutes);
}

function formatMinuteOfDayLabel(minutes: number) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 < 12 ? "AM" : "PM";

  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )} ${meridiem}`;
}

function formatOffsetFromStoreHours(offsetMinutes: number) {
  const option = AUTOMATION_START_OFFSET_OPTIONS.find(
    (entry) => Number(entry.value) === offsetMinutes,
  );
  if (option) return option.label;

  const absoluteMinutes = Math.abs(offsetMinutes);
  const unitLabel = absoluteMinutes === 1 ? "minute" : "minutes";
  if (offsetMinutes < 0) {
    return `${absoluteMinutes} ${unitLabel} before opening`;
  }
  if (offsetMinutes > 0) {
    return `${absoluteMinutes} ${unitLabel} after opening`;
  }
  return "At opening";
}

function formatOffsetFromStoreClose(offsetMinutes: number) {
  const option = EOD_COMPLETION_OFFSET_OPTIONS.find(
    (entry) => Number(entry.value) === offsetMinutes,
  );
  if (option) return option.label;

  const absoluteMinutes = Math.abs(offsetMinutes);
  const unitLabel = absoluteMinutes === 1 ? "minute" : "minutes";
  if (offsetMinutes < 0) {
    return `${absoluteMinutes} ${unitLabel} before close`;
  }
  if (offsetMinutes > 0) {
    return `${absoluteMinutes} ${unitLabel} after close`;
  }
  return "At close";
}

type StoreScheduleSummary = {
  context?: {
    currentWindow?: {
      localEndLabel: string;
      localStartLabel: string;
    } | null;
    isOpen?: boolean;
    nextWindow?: {
      localEndLabel: string;
      localStartLabel: string;
    } | null;
    phase?: string;
    timezone?: string | null;
  } | null;
  schedule?: {
    timezone?: string | null;
  } | null;
};

type StoreScheduleSummaryQuery = FunctionReference<
  "query",
  "public",
  { storeId: Id<"store"> },
  StoreScheduleSummary | null
>;

const storeScheduleApi = (
  api as unknown as {
    inventory: {
      storeSchedule: {
        getStoreScheduleSummary: StoreScheduleSummaryQuery;
      };
    };
  }
).inventory.storeSchedule;

function StoreHoursTimingReadout({
  orgUrlSlug,
  readOnly = false,
  storeId,
  storeUrlSlug,
}: {
  orgUrlSlug?: string;
  readOnly?: boolean;
  storeId?: Id<"store"> | null;
  storeUrlSlug?: string;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const scheduleSummary = useQuery(
    storeScheduleApi.getStoreScheduleSummary,
    storeId ? { storeId } : "skip",
  ) as StoreScheduleSummary | null | undefined;
  const scheduleContext = scheduleSummary?.context;
  const currentOrNextWindow =
    scheduleContext?.currentWindow ?? scheduleContext?.nextWindow ?? null;
  const openingTiming = currentOrNextWindow?.localStartLabel
    ? `Opening at ${formatStoreHoursTimeLabel(
      currentOrNextWindow.localStartLabel,
    )}`
    : scheduleContext?.phase === "closed"
      ? "Store is closed today."
      : "Opening timing is waiting for Store Hours.";
  const eodTiming = currentOrNextWindow?.localEndLabel
    ? `EOD after ${formatStoreHoursTimeLabel(
      currentOrNextWindow.localEndLabel,
    )}`
    : "EOD timing is waiting for Store Hours.";
  const timezone =
    scheduleContext?.timezone ??
    scheduleSummary?.schedule?.timezone ??
    "Store timezone not configured";

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          Store Hours timing
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Athena uses Store Hours to time Opening and EOD automation.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Timing comes from Store Hours
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {timezone}
          </span>
        </div>

        <dl className="grid gap-layout-sm text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">Opening</dt>
            <dd className="mt-layout-2xs text-muted-foreground">
              {openingTiming}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">EOD</dt>
            <dd className="mt-layout-2xs text-muted-foreground">{eodTiming}</dd>
          </div>
        </dl>

        {!readOnly && !isLoading && hasFullAdminAccess && orgUrlSlug && storeUrlSlug ? (
          <Button asChild size="sm" variant="outline">
            <HealthLink
              params={{
                orgUrlSlug,
                storeUrlSlug,
              }}
              to="/$orgUrlSlug/store/$storeUrlSlug/configuration"
            >
              Open Store Hours
              <ArrowUpRight aria-hidden="true" />
            </HealthLink>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function RegisterCloseoutApprovalPolicyAdminPanel({
  currency,
  readOnly = false,
  storeId,
}: {
  currency: string;
  readOnly?: boolean;
  storeId?: Id<"store"> | null;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const policy = useQuery(
    api.operations.dailyOperationsAutomation.getRegisterCloseoutApprovalPolicy,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as RegisterCloseoutApprovalPolicy | null | undefined;
  const updateRegisterCloseoutApprovalPolicy = useMutation(
    api.operations.dailyOperationsAutomation
      .updateRegisterCloseoutApprovalPolicy,
  ) as unknown as UpdateRegisterCloseoutApprovalPolicy;
  const [varianceApprovalThreshold, setVarianceApprovalThreshold] =
    useState("50");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const currencySymbol = currencyDisplaySymbol(currency);
  const parsedVarianceApprovalThreshold = parseNonNegativeMoneyInput(
    varianceApprovalThreshold,
  );
  const canSave =
    Boolean(storeId) && parsedVarianceApprovalThreshold !== null && !isSaving;

  useEffect(() => {
    if (policy?.varianceApprovalThreshold == null) {
      return;
    }

    setVarianceApprovalThreshold(
      formatMinorUnitInputValue(policy.varianceApprovalThreshold),
    );
  }, [policy?.varianceApprovalThreshold]);

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const handleSave = async () => {
    if (!storeId) {
      setMessage({
        kind: "error",
        text: "Select a store before saving closeout approval policy.",
      });
      return;
    }

    if (parsedVarianceApprovalThreshold === null) {
      setMessage({
        kind: "error",
        text: "Enter a valid closeout variance threshold.",
      });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      await updateRegisterCloseoutApprovalPolicy({
        storeId,
        varianceApprovalThreshold: parsedVarianceApprovalThreshold,
      });
      setMessage({
        kind: "success",
        text: "Closeout approval policy saved.",
      });
      toast.success("Closeout approval policy saved.");
    } catch (error) {
      console.error(error);
      setMessage({
        kind: "error",
        text: "Closeout approval policy was not saved.",
      });
      toast.error("Closeout approval policy was not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          Closeout approval policy
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Set when register cash variances require manager review before final
          closeout.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Manager review above threshold
          </span>
          {policy?.requireManagerSignoffForAnyVariance ? (
            <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
              Any variance requires review
            </span>
          ) : null}
          {policy?.requireManagerSignoffForOvers ? (
            <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
              Overage review enabled
            </span>
          ) : null}
          {policy?.requireManagerSignoffForShorts ? (
            <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
              Shortage review enabled
            </span>
          ) : null}
        </div>

        <div className="max-w-[18rem] space-y-layout-xs">
          <Label htmlFor="register-closeout-variance-threshold">
            Closeout variance threshold ({currencySymbol})
          </Label>
          <Input
            id="register-closeout-variance-threshold"
            min={0}
            onChange={(event) =>
              setVarianceApprovalThreshold(event.target.value)
            }
            step="0.01"
            type="number"
            value={varianceApprovalThreshold}
            readOnly={readOnly}
          />
          <p className="text-sm leading-5 text-muted-foreground">
            Variances greater than this amount require manager approval.
          </p>
        </div>

        {message ? (
          <div
            className={
              message.kind === "error"
                ? "rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
                : "rounded-md border border-success/20 bg-success/10 px-layout-md py-layout-sm text-sm text-success"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <div className="border-t border-border pt-layout-md">
          <LoadingButton
            disabled={readOnly || !canSave}
            isLoading={isSaving}
            onClick={handleSave}
            variant="primary-soft"
          >
            Save closeout approval policy
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

function EodCompletionAutomationAdminPanel({
  currency,
  readOnly = false,
  storeId,
}: {
  currency: string;
  readOnly?: boolean;
  storeId?: Id<"store"> | null;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const policy = useQuery(
    api.operations.dailyOperationsAutomation.getEodAutoCompletePolicy,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as EodAutoCompletePolicy | null | undefined;
  const scheduleSummary = useQuery(
    storeScheduleApi.getStoreScheduleSummary,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as StoreScheduleSummary | null | undefined;
  const updateEodAutoCompletePolicy = useMutation(
    api.operations.dailyOperationsAutomation.updateEodAutoCompletePolicy,
  ) as unknown as UpdateEodAutoCompletePolicy;
  const [mode, setMode] = useState<AutomationPolicyMode>("disabled");
  const [cleanDayAutoCompleteEnabled, setCleanDayAutoCompleteEnabled] =
    useState(false);
  const [completionOffsetMinutes, setCompletionOffsetMinutes] = useState(0);
  const [maxAbsoluteCashVariance, setMaxAbsoluteCashVariance] = useState("0");
  const [maxVoidedSaleCount, setMaxVoidedSaleCount] = useState("0");
  const [maxVoidedSaleTotal, setMaxVoidedSaleTotal] = useState("0");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const policyMode = policy?.mode;
  const policyCleanDayAutoCompleteEnabled = policy?.cleanDayAutoCompleteEnabled;
  const policyMaxAbsoluteCashVariance = policy?.maxAbsoluteCashVariance;
  const policyMaxVoidedSaleCount = policy?.maxVoidedSaleCount;
  const policyMaxVoidedSaleTotal = policy?.maxVoidedSaleTotal;
  const currencySymbol = currencyDisplaySymbol(currency);
  const scheduleContext = scheduleSummary?.context;
  const currentOrNextWindow =
    scheduleContext?.currentWindow ?? scheduleContext?.nextWindow ?? null;
  const storeCloseMinute = parseStoreHoursTimeLabel(
    currentOrNextWindow?.localEndLabel,
  );
  const selectedCompletionMinute =
    storeCloseMinute === null
      ? (policy?.localCompletionWindowMinutes ??
        DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES)
      : normalizeMinuteOfDay(storeCloseMinute + completionOffsetMinutes);
  const selectedCompletionOffsetLabel = formatOffsetFromStoreClose(
    completionOffsetMinutes,
  );
  const completionOffsetOptions = EOD_COMPLETION_OFFSET_OPTIONS.some(
    (option) => Number(option.value) === completionOffsetMinutes,
  )
    ? EOD_COMPLETION_OFFSET_OPTIONS
    : [
      ...EOD_COMPLETION_OFFSET_OPTIONS,
      {
        value: String(completionOffsetMinutes),
        label: selectedCompletionOffsetLabel,
      },
    ].sort((left, right) => Number(left.value) - Number(right.value));
  const storeCloseLabel = formatStoreHoursTimeLabel(
    currentOrNextWindow?.localEndLabel,
  );
  const selectedCompletionTimeLabel = formatMinuteOfDayLabel(
    selectedCompletionMinute,
  );

  useEffect(() => {
    if (
      policy?.localCompletionWindowMinutes == null ||
      storeCloseMinute === null
    ) {
      setCompletionOffsetMinutes(0);
      return;
    }

    const rawOffset = policy.localCompletionWindowMinutes - storeCloseMinute;
    const normalizedOffset =
      rawOffset > 12 * 60
        ? rawOffset - 24 * 60
        : rawOffset < -12 * 60
          ? rawOffset + 24 * 60
          : rawOffset;
    setCompletionOffsetMinutes(normalizedOffset);
  }, [policy?.localCompletionWindowMinutes, storeCloseMinute]);

  useEffect(() => {
    if (
      policyMode == null &&
      policyCleanDayAutoCompleteEnabled == null &&
      policyMaxAbsoluteCashVariance == null &&
      policyMaxVoidedSaleCount == null &&
      policyMaxVoidedSaleTotal == null
    ) {
      return;
    }

    setMode(normalizeAutomationPolicyMode(policyMode));
    setCleanDayAutoCompleteEnabled(Boolean(policyCleanDayAutoCompleteEnabled));
    setMaxAbsoluteCashVariance(
      formatMinorUnitInputValue(policyMaxAbsoluteCashVariance),
    );
    setMaxVoidedSaleCount(String(policyMaxVoidedSaleCount ?? 0));
    setMaxVoidedSaleTotal(formatMinorUnitInputValue(policyMaxVoidedSaleTotal));
  }, [
    policyCleanDayAutoCompleteEnabled,
    policyMaxAbsoluteCashVariance,
    policyMaxVoidedSaleCount,
    policyMaxVoidedSaleTotal,
    policyMode,
  ]);

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const parsedMaxAbsoluteCashVariance = parseNonNegativeMoneyInput(
    maxAbsoluteCashVariance,
  );
  const parsedMaxVoidedSaleCount =
    parseNonNegativeIntegerInput(maxVoidedSaleCount);
  const parsedMaxVoidedSaleTotal =
    parseNonNegativeMoneyInput(maxVoidedSaleTotal);
  const canSave =
    Boolean(storeId) &&
    parsedMaxAbsoluteCashVariance !== null &&
    parsedMaxVoidedSaleCount !== null &&
    parsedMaxVoidedSaleTotal !== null &&
    !isSaving;

  const handleSave = async () => {
    if (!storeId) {
      setMessage({
        kind: "error",
        text: "Select a store before saving EOD completion automation.",
      });
      return;
    }

    if (
      parsedMaxAbsoluteCashVariance === null ||
      parsedMaxVoidedSaleCount === null ||
      parsedMaxVoidedSaleTotal === null
    ) {
      setMessage({
        kind: "error",
        text: "Enter valid EOD completion automation thresholds.",
      });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      await updateEodAutoCompletePolicy({
        cleanDayAutoCompleteEnabled,
        localCompletionWindowMinutes: selectedCompletionMinute,
        maxAbsoluteCashVariance: parsedMaxAbsoluteCashVariance,
        maxVoidedSaleCount: parsedMaxVoidedSaleCount,
        maxVoidedSaleTotal: parsedMaxVoidedSaleTotal,
        mode,
        operatingTimezoneOffsetMinutes:
          policy?.operatingTimezoneOffsetMinutes ?? undefined,
        storeId,
      });
      setMessage({
        kind: "success",
        text: "EOD completion automation settings saved.",
      });
      toast.success("EOD completion automation settings saved.");
    } catch (error) {
      console.error(error);
      setMessage({
        kind: "error",
        text: "EOD completion automation settings were not saved.",
      });
      toast.error("EOD completion automation settings were not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          EOD completion automation
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Athena can complete clean or low-risk EOD Reviews under store policy.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {mode === "enabled"
              ? "Enabled"
              : mode === "dry_run"
                ? "Dry run"
                : "Disabled"}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Review items are checked against policy, not resolved.
          </span>
        </div>

        <RadioGroup
          className="grid gap-layout-sm sm:grid-cols-[repeat(3,minmax(10rem,18rem))]"
          value={mode}
          onValueChange={(value) =>
            setMode(
              normalizeAutomationPolicyMode(value as AutomationPolicyMode),
            )
          }
        >
          {[
            {
              value: "disabled",
              label: "Disable EOD completion",
              description: "Athena will not complete EOD Reviews.",
            },
            {
              value: "dry_run",
              label: "Dry run EOD completion",
              description: "Athena checks eligibility without completing.",
            },
            {
              value: "enabled",
              label: "Enable EOD completion",
              description:
                "Athena completes eligible EOD Reviews under policy.",
            },
          ].map((option) => (
            <label
              className="flex min-h-[6.5rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-action-neutral-soft"
              key={option.value}
              onMouseDown={
                readOnly
                  ? undefined
                  : () => setMode(option.value as AutomationPolicyMode)
              }
            >
              <span className="flex items-start gap-layout-xs">
                <RadioGroupItem
                  aria-label={option.label}
                  disabled={readOnly}
                  onClick={
                    readOnly
                      ? undefined
                      : () => setMode(option.value as AutomationPolicyMode)
                  }
                  value={option.value}
                />
                <span className="font-medium text-foreground">
                  {option.label}
                </span>
              </span>
              <span className="text-xs leading-5 text-muted-foreground">
                {option.description}
              </span>
            </label>
          ))}
        </RadioGroup>

        <div className="grid gap-layout-md">
          <div className="max-w-[18rem] space-y-layout-xs">
            <Label htmlFor="eod-completion-offset">EOD completion offset</Label>
            <Select
              disabled={readOnly}
              onValueChange={(value) =>
                setCompletionOffsetMinutes(Number(value))
              }
              value={String(completionOffsetMinutes)}
            >
              <SelectTrigger
                aria-label="EOD completion offset"
                className="h-control-standard bg-background"
                id="eod-completion-offset"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {completionOffsetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm leading-5 text-muted-foreground">
              {storeCloseMinute === null
                ? " Set a close time to derive timing."
                : `Close ${storeCloseLabel}. Runs ${selectedCompletionTimeLabel}.`}
            </p>
          </div>

          <label className="flex min-h-[5rem] w-fit max-w-full justify-self-start items-start gap-layout-sm rounded-md border border-border bg-background p-layout-sm text-sm">
            <Checkbox
              aria-label="Enable blocker-free completion"
              checked={cleanDayAutoCompleteEnabled}
              className="mt-1"
              disabled={readOnly}
              onCheckedChange={(checked) =>
                setCleanDayAutoCompleteEnabled(checked === true)
              }
            />
            <span>
              <span className="block font-medium text-foreground">
                Enable blocker-free completion
              </span>
              <span className="mt-1 block leading-5 text-muted-foreground">
                Athena can complete blocker-free days and preserve carry-forward
                work for Opening when automation is enabled.
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-layout-md sm:grid-cols-[repeat(3,minmax(10rem,14rem))]">
          <div className="space-y-layout-xs min-w-0">
            <Label htmlFor="eod-cash-variance-threshold">
              Cash variance threshold ({currencySymbol})
            </Label>
            <Input
              id="eod-cash-variance-threshold"
              min={0}
              onChange={(event) =>
                setMaxAbsoluteCashVariance(event.target.value)
              }
              step="0.01"
              type="number"
              value={maxAbsoluteCashVariance}
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-layout-xs min-w-0">
            <Label htmlFor="eod-voided-sale-count-threshold">
              Voided sale count threshold
            </Label>
            <Input
              id="eod-voided-sale-count-threshold"
              min={0}
              onChange={(event) => setMaxVoidedSaleCount(event.target.value)}
              type="number"
              value={maxVoidedSaleCount}
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-layout-xs min-w-0">
            <Label htmlFor="eod-voided-sale-total-threshold">
              Voided sale total threshold ({currencySymbol})
            </Label>
            <Input
              id="eod-voided-sale-total-threshold"
              min={0}
              onChange={(event) => setMaxVoidedSaleTotal(event.target.value)}
              step="0.01"
              type="number"
              value={maxVoidedSaleTotal}
              readOnly={readOnly}
            />
          </div>
        </div>

        {message ? (
          <div
            className={
              message.kind === "error"
                ? "rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
                : "rounded-md border border-success/20 bg-success/10 px-layout-md py-layout-sm text-sm text-success"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <div className="border-t border-border pt-layout-md">
          <LoadingButton
            disabled={readOnly || !canSave}
            isLoading={isSaving}
            onClick={handleSave}
            variant="primary-soft"
          >
            Save EOD completion automation
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

function StoreDayAutomationAdminPanel({
  readOnly = false,
  storeId,
}: {
  readOnly?: boolean;
  storeId?: Id<"store"> | null;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const policy = useQuery(
    api.operations.dailyOperationsAutomation.getOpeningAutoStartPolicy,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as StoreDayAutomationPolicy | null | undefined;
  const scheduleSummary = useQuery(
    storeScheduleApi.getStoreScheduleSummary,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as StoreScheduleSummary | null | undefined;
  const updateOpeningAutoStartPolicy = useMutation(
    api.operations.dailyOperationsAutomation.updateOpeningAutoStartPolicy,
  ) as unknown as UpdateOpeningAutoStartPolicy;
  const [isEnabled, setIsEnabled] = useState(false);
  const [startOffsetMinutes, setStartOffsetMinutes] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const policyMode = policy?.mode;
  const scheduleContext = scheduleSummary?.context;
  const currentOrNextWindow =
    scheduleContext?.currentWindow ?? scheduleContext?.nextWindow ?? null;
  const storeOpeningMinute = parseStoreHoursTimeLabel(
    currentOrNextWindow?.localStartLabel,
  );
  const selectedStartMinute =
    storeOpeningMinute === null
      ? (policy?.localStartMinutes ?? DEFAULT_OPENING_LOCAL_START_MINUTES)
      : normalizeMinuteOfDay(storeOpeningMinute + startOffsetMinutes);
  const selectedStartOffsetLabel =
    formatOffsetFromStoreHours(startOffsetMinutes);
  const startOffsetOptions = AUTOMATION_START_OFFSET_OPTIONS.some(
    (option) => Number(option.value) === startOffsetMinutes,
  )
    ? AUTOMATION_START_OFFSET_OPTIONS
    : [
      ...AUTOMATION_START_OFFSET_OPTIONS,
      { value: String(startOffsetMinutes), label: selectedStartOffsetLabel },
    ].sort((left, right) => Number(left.value) - Number(right.value));
  const storeOpeningLabel = formatStoreHoursTimeLabel(
    currentOrNextWindow?.localStartLabel,
  );
  const selectedStartTimeLabel = formatMinuteOfDayLabel(selectedStartMinute);

  useEffect(() => {
    if (policyMode == null) {
      return;
    }

    setIsEnabled(policyMode === "enabled");
  }, [policyMode]);

  useEffect(() => {
    if (policy?.localStartMinutes == null || storeOpeningMinute === null) {
      setStartOffsetMinutes(0);
      return;
    }

    const rawOffset = policy.localStartMinutes - storeOpeningMinute;
    const normalizedOffset =
      rawOffset > 12 * 60
        ? rawOffset - 24 * 60
        : rawOffset < -12 * 60
          ? rawOffset + 24 * 60
          : rawOffset;
    setStartOffsetMinutes(normalizedOffset);
  }, [policy?.localStartMinutes, storeOpeningMinute]);

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const canSave = Boolean(storeId) && !isSaving;

  const handleSave = async () => {
    if (!storeId) {
      setMessage({
        kind: "error",
        text: "Select a store before saving store-day automation.",
      });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      await updateOpeningAutoStartPolicy({
        localStartMinutes: selectedStartMinute,
        mode: isEnabled ? "enabled" : "disabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes:
          policy?.operatingTimezoneOffsetMinutes ?? undefined,
        storeId,
      });
      setMessage({
        kind: "success",
        text: "Store-day automation settings saved.",
      });
      toast.success("Store-day automation settings saved.");
    } catch (error) {
      console.error(error);
      setMessage({
        kind: "error",
        text: "Store-day automation settings were not saved.",
      });
      toast.error("Store-day automation settings were not saved.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          Store day automation
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Athena can start the store day on schedule and keep opening review
          items for manager follow-up.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {isEnabled ? "Enabled" : "Disabled"}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Blockers stay available for manager review.
          </span>
        </div>

        <div className="grid gap-layout-md">
          <label className="flex min-h-[5rem] w-fit max-w-full justify-self-start items-start gap-layout-sm rounded-md border border-border bg-background p-layout-sm text-sm">
            <Checkbox
              aria-label="Enable store-day auto-start"
              checked={isEnabled}
              className="mt-1"
              disabled={readOnly}
              onCheckedChange={(checked) => setIsEnabled(checked === true)}
            />
            <span>
              <span className="block font-medium text-foreground">
                Enable store-day auto-start
              </span>
              <span className="mt-1 block leading-5 text-muted-foreground">
                {storeOpeningMinute === null
                  ? " Set an opening time to derive timing."
                  : `Opening ${storeOpeningLabel}. Runs ${selectedStartTimeLabel}.`}
              </span>
            </span>
          </label>

          <div className="max-w-[18rem] space-y-layout-xs">
            <div className="space-y-layout-xs">
              <Label htmlFor="store-day-auto-start-offset">
                Auto-start offset
              </Label>
              <Select
                disabled={readOnly}
                onValueChange={(value) => setStartOffsetMinutes(Number(value))}
                value={String(startOffsetMinutes)}
              >
                <SelectTrigger
                  aria-label="Store day auto-start offset"
                  className="h-control-standard bg-background"
                  id="store-day-auto-start-offset"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {startOffsetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {message ? (
          <div
            className={
              message.kind === "error"
                ? "rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
                : "rounded-md border border-success/20 bg-success/10 px-layout-md py-layout-sm text-sm text-success"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}

        <div className="border-t border-border pt-layout-md">
          <LoadingButton
            disabled={readOnly || !canSave}
            isLoading={isSaving}
            onClick={handleSave}
            variant="primary-soft"
          >
            Save store-day automation
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

function POSRecoveryCodeAdminPanel({ storeId }: { storeId?: string | null }) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const status = useQuery(
    api.pos.public.posRecoveryCodes.getRecoveryCodeStatus,
    !isLoading && hasFullAdminAccess && storeId
      ? { storeId: storeId as never }
      : "skip",
  ) as
    | {
      failedAttemptCount: number;
      lastUsedAt?: number;
      lockedUntil?: number;
      plaintextCode?: string;
      rotatedAt: number;
      status: "active" | "locked" | "revoked";
    }
    | null
    | undefined;
  const rotateRecoveryCode = useMutation(
    api.pos.public.posRecoveryCodes.rotateRecoveryCode,
  );
  const unlockRecoveryCode = useMutation(
    api.pos.public.posRecoveryCodes.unlockRecoveryCode,
  );
  const revokeRecoveryCode = useMutation(
    api.pos.public.posRecoveryCodes.revokeRecoveryCode,
  );
  const [isRotating, setIsRotating] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);

  const handleRotate = async () => {
    if (!storeId) {
      toast.error("Select a store before managing POS recovery codes");
      return;
    }
    setIsRotating(true);
    setRevealedCode(null);
    try {
      const result = await rotateRecoveryCode({ storeId: storeId as never });
      setRevealedCode(result.code);
      toast.success("POS recovery code rotated");
    } catch (error) {
      console.error(error);
      toast.error("Unable to rotate POS recovery code");
    } finally {
      setIsRotating(false);
    }
  };

  const handleUnlock = async () => {
    if (!storeId) {
      return;
    }
    setIsUnlocking(true);
    try {
      await unlockRecoveryCode({ storeId: storeId as never });
      toast.success("POS recovery code unlocked");
    } catch (error) {
      console.error(error);
      toast.error("Unable to unlock POS recovery code");
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleRevoke = async () => {
    if (!storeId) {
      return;
    }
    setIsRevoking(true);
    setRevealedCode(null);
    try {
      await revokeRecoveryCode({ storeId: storeId as never });
      toast.success("POS recovery code revoked");
    } catch (error) {
      console.error(error);
      toast.error("Unable to revoke POS recovery code");
    } finally {
      setIsRevoking(false);
    }
  };

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const statusLabel = status?.status ?? "not configured";
  const currentRecoveryCode = revealedCode ?? status?.plaintextCode ?? null;

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          POS recovery code
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Manage the recovery code for the shared POS app account. The current
          code stays visible to full admins.
        </p>
      </div>

      <div className="space-y-layout-lg">
        <div className="flex flex-wrap gap-layout-xs">
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            {statusLabel}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Rotated {formatRecoveryTimestamp(status?.rotatedAt)}
          </span>
          <span className="inline-flex rounded-full border border-border bg-background px-layout-sm py-layout-2xs text-sm text-muted-foreground">
            Used {formatRecoveryTimestamp(status?.lastUsedAt)}
          </span>
        </div>

        {currentRecoveryCode ? (
          <div
            className="w-fit max-w-full rounded-md border border-primary/30 bg-primary/10 px-layout-md py-layout-sm"
            role="status"
          >
            <p className="text-sm font-medium text-foreground">
              Current recovery code
            </p>
            <p className="mt-layout-xs font-mono text-lg tracking-wide text-foreground">
              {currentRecoveryCode}
            </p>
            <p className="mt-layout-xs text-sm text-muted-foreground">
              Keep this with the field operations runbook. Rotate it when staff
              need a new code.
            </p>
          </div>
        ) : null}

        <div className="grid gap-layout-sm text-sm text-muted-foreground sm:grid-cols-3">
          <div>
            <p className="font-medium text-foreground">Failed attempts</p>
            <p>{status?.failedAttemptCount ?? 0}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Lockout</p>
            <p>{formatRecoveryTimestamp(status?.lockedUntil)}</p>
          </div>
          <div>
            <p className="font-medium text-foreground">Plaintext</p>
            <p>{currentRecoveryCode ? "Visible" : "Rotate to show"}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-layout-sm border-t border-border pt-layout-md">
          <LoadingButton
            isLoading={isRotating}
            disabled={!storeId || isRotating}
            onClick={handleRotate}
            variant="primary-soft"
          >
            {status ? "Rotate recovery code" : "Create recovery code"}
          </LoadingButton>
          <LoadingButton
            isLoading={isUnlocking}
            disabled={!storeId || status?.status !== "locked" || isUnlocking}
            onClick={handleUnlock}
            variant="outline"
          >
            Unlock
          </LoadingButton>
          <LoadingButton
            isLoading={isRevoking}
            disabled={
              !storeId || !status || status.status === "revoked" || isRevoking
            }
            onClick={handleRevoke}
            variant="outline"
          >
            Revoke
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

type PosSettingsLocalReadinessStore = PosLocalStorePort;

function createDefaultLocalReadinessStore() {
  return getDefaultPosLocalStore();
}

const defaultPosSettingsStoreFactory = () => getDefaultPosLocalStore();

function signalFromSnapshot(
  snapshot:
    | { ok: true; value: { refreshedAt?: number } | null }
    | { ok: false }
    | null
    | undefined,
): PosOfflineReadinessInput["registerCatalog"] {
  if (!snapshot?.ok) {
    return { ready: false };
  }
  if (!snapshot.value) {
    return { ready: false };
  }

  return {
    ageMs:
      typeof snapshot.value.refreshedAt === "number"
        ? Date.now() - snapshot.value.refreshedAt
        : undefined,
    ready: true,
  };
}

function signalFromAppSession(input: {
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  isAuthLoading: boolean;
  hasUser: boolean;
}): PosOfflineReadinessInput["appSession"] {
  if (input.hasUser) {
    return { ready: true };
  }

  const status = input.appSessionRecovery?.status;
  if (!status) {
    return input.isAuthLoading ? null : { ready: false };
  }

  if (status === "recoverable") {
    return { ready: true };
  }

  if (status === "waiting_for_network") {
    return { status: "local_continuation" };
  }

  return { ready: false };
}

function usePosSettingsOfflineReadiness(input: {
  appSessionRecovery?: PosTerminalRuntimeAppSessionRecoveryInput | null;
  existingTerminal: ProvisionedTerminalRecord | null;
  storeFactory?: Parameters<
    typeof registerAndProvisionPosTerminal
  >[0]["storeFactory"];
  hasUser: boolean;
  isAuthLoading: boolean;
  storeId?: string;
  orgUrlSlug?: string;
  storeUrlSlug?: string;
}) {
  const {
    appSessionRecovery,
    existingTerminal,
    hasUser,
    isAuthLoading,
    orgUrlSlug,
    storeFactory,
    storeId,
    storeUrlSlug,
  } = input;
  const [signals, setSignals] = useState<PosOfflineReadinessInput>({
    appSession: signalFromAppSession({
      appSessionRecovery,
      hasUser,
      isAuthLoading,
    }),
    appShell: null,
    availabilitySnapshot: null,
    registerCatalog: null,
    serviceCatalog: null,
    staffAuthority: null,
    terminalSeed: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadReadiness() {
      const appShell = await readPosAppShellReadiness({
        orgUrlSlug,
        storeUrlSlug,
      });

      if (!storeId || !existingTerminal) {
        if (!cancelled) {
          setSignals({
            appSession: signalFromAppSession({
              appSessionRecovery,
              hasUser,
              isAuthLoading,
            }),
            appShell,
            availabilitySnapshot: { ready: false },
            registerCatalog: { ready: false },
            serviceCatalog: { ready: false },
            staffAuthority: { ready: false },
            terminalSeed: { ready: false },
          });
        }
        return;
      }

      const store =
        (storeFactory?.() as PosSettingsLocalReadinessStore | undefined) ??
        createDefaultLocalReadinessStore();
      if (!store) {
        if (!cancelled) {
          setSignals({
            appSession: signalFromAppSession({
              appSessionRecovery,
              hasUser,
              isAuthLoading,
            }),
            appShell,
            availabilitySnapshot: { ready: false },
            registerCatalog: { ready: false },
            serviceCatalog: { ready: false },
            staffAuthority: { ready: false },
            terminalSeed: { ready: false },
          });
        }
        return;
      }

      const [
        terminalSeed,
        staffAuthority,
        registerCatalog,
        serviceCatalog,
        availabilitySnapshot,
      ] = await Promise.all([
        store
          .readProvisionedTerminalSeed?.()
          .catch(() => ({ ok: false as const })) ??
        Promise.resolve({ ok: true as const, value: null }),
        store
          .getStaffAuthorityReadiness?.({
            storeId,
            terminalId: existingTerminal._id,
          })
          .catch(() => ({ ok: false as const })) ??
        Promise.resolve({ ok: true as const, value: "missing" as const }),
        store
          .readRegisterCatalogSnapshot?.({ storeId })
          .catch(() => ({ ok: false as const })) ??
        Promise.resolve({ ok: true as const, value: null }),
        store
          .readRegisterServiceCatalogSnapshot?.({ storeId })
          .catch(() => ({ ok: false as const })) ??
        Promise.resolve({ ok: true as const, value: null }),
        store
          .readRegisterAvailabilitySnapshot?.({ storeId })
          .catch(() => ({ ok: false as const })) ??
        Promise.resolve({ ok: true as const, value: null }),
      ]);

      if (cancelled) return;

      const localTerminalSeed = terminalSeed.ok ? terminalSeed.value : null;
      setSignals({
        appSession: signalFromAppSession({
          appSessionRecovery,
          hasUser,
          isAuthLoading,
        }),
        appShell,
        availabilitySnapshot: signalFromSnapshot(availabilitySnapshot),
        registerCatalog: signalFromSnapshot(registerCatalog),
        serviceCatalog: signalFromSnapshot(serviceCatalog),
        staffAuthority: {
          ready: staffAuthority.ok && staffAuthority.value === "ready",
        },
        terminalSeed: {
          ready:
            Boolean(localTerminalSeed) &&
            localTerminalSeed?.storeId === storeId &&
            localTerminalSeed?.cloudTerminalId === existingTerminal._id,
        },
      });
    }

    void loadReadiness();

    return () => {
      cancelled = true;
    };
  }, [
    appSessionRecovery,
    existingTerminal,
    hasUser,
    isAuthLoading,
    orgUrlSlug,
    storeFactory,
    storeId,
    storeUrlSlug,
  ]);

  return signals;
}

export function POSSettingsView({
  storeFactory = defaultPosSettingsStoreFactory,
}: {
  storeFactory?: Parameters<
    typeof registerAndProvisionPosTerminal
  >[0]["storeFactory"];
} = {}) {
  const { activeStore } = useGetActiveStore();
  const { isLoading: isAuthLoading, user } = useAuth();
  const sharedDemoContext = useSharedDemoContext();
  const isReadOnlyDemoSurface =
    isSharedDemoUiEnabled && sharedDemoContext !== null;
  const appSessionRecovery = usePosTerminalAppSessionRecoveryRuntimeInput();
  const routeParams = useParams({ strict: false }) as
    | {
      orgUrlSlug?: string;
      storeUrlSlug?: string;
    }
    | undefined;

  const registerTerminalMutation = useMutation(
    api.inventory.posTerminal.registerTerminal,
  );
  const [fingerprintResult, setFingerprintResult] =
    useState<BrowserFingerprintResult | null>(null);
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);
  const [isFingerprintLoading, setIsFingerprintLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [registerNumber, setRegisterNumber] = useState("");
  const [registerNumberTouched, setRegisterNumberTouched] = useState(false);
  const [transactionCapability, setTransactionCapability] =
    useState<PosTerminalTransactionCapability>(
      DEFAULT_POS_TERMINAL_TRANSACTION_CAPABILITY,
    );
  const [transactionCapabilityTouched, setTransactionCapabilityTouched] =
    useState(false);
  const [loginMode, setLoginMode] = useState<PosTerminalLoginMode>(
    DEFAULT_POS_TERMINAL_LOGIN_MODE,
  );
  const [loginModeTouched, setLoginModeTouched] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);
  const fingerprintHash = fingerprintResult?.fingerprintHash;

  const currentTerminal = useQuery(
    api.inventory.posTerminal.getTerminalByFingerprint,
    activeStore?._id && fingerprintHash
      ? { storeId: activeStore._id, fingerprintHash }
      : "skip",
  ) as ProvisionedTerminalRecord | null | undefined;

  const existingTerminal = currentTerminal ?? null;
  const isRegisterNumberLocked = Boolean(existingTerminal?.registerNumber);

  useEffect(() => {
    if (nameTouched) {
      return;
    }
    if (existingTerminal) {
      setDisplayName(existingTerminal.displayName);
      return;
    }
    setDisplayName("");
  }, [existingTerminal, nameTouched]);

  useEffect(() => {
    if (registerNumberTouched) {
      return;
    }
    if (existingTerminal) {
      setRegisterNumber(existingTerminal.registerNumber ?? "");
      return;
    }
    setRegisterNumber("");
  }, [existingTerminal, registerNumberTouched]);

  useEffect(() => {
    if (transactionCapabilityTouched) {
      return;
    }
    setTransactionCapability(
      normalizePosTerminalTransactionCapability(
        existingTerminal?.transactionCapability,
      ),
    );
  }, [existingTerminal, transactionCapabilityTouched]);

  useEffect(() => {
    if (loginModeTouched) {
      return;
    }
    setLoginMode(normalizePosTerminalLoginMode(existingTerminal?.loginMode));
  }, [existingTerminal, loginModeTouched]);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") {
      return;
    }
    const loadFingerprint = async () => {
      setIsFingerprintLoading(true);
      setFingerprintError(null);

      try {
        const stored = window.localStorage.getItem(FINGERPRINT_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(
            stored,
          ) as Partial<BrowserFingerprintResult>;
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.fingerprintHash === "string" &&
            parsed.browserInfo
          ) {
            if (!cancelled) {
              setFingerprintResult(parsed as BrowserFingerprintResult);
              setIsFingerprintLoading(false);
              return;
            }
          } else {
            window.localStorage.removeItem(FINGERPRINT_STORAGE_KEY);
          }
        }
      } catch (error) {
        console.error("Failed to read stored fingerprint", error);
      }

      try {
        const result = await generateBrowserFingerprint();
        if (!cancelled) {
          setFingerprintResult(result);
          window.localStorage.setItem(
            FINGERPRINT_STORAGE_KEY,
            JSON.stringify(result),
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFingerprintError(
            error instanceof Error
              ? error.message
              : "Unable to generate fingerprint",
          );
        }
      } finally {
        if (!cancelled) {
          setIsFingerprintLoading(false);
        }
      }
    };

    loadFingerprint();

    return () => {
      cancelled = true;
    };
  }, []);

  const registrationState = useMemo(() => {
    const trimmedDisplayName = displayName.trim();
    const trimmedRegisterNumber = registerNumber.trim();
    const isExistingTerminal = !!existingTerminal;
    const isRegisterNumberSet = Boolean(existingTerminal?.registerNumber);

    return {
      trimmedDisplayName,
      trimmedRegisterNumber,
      isExistingTerminal,
      existingTerminalName: existingTerminal?.displayName ?? null,
      existingTerminalRegisterNumber: existingTerminal?.registerNumber ?? null,
      canRegister:
        !!fingerprintResult &&
        !fingerprintError &&
        !!trimmedDisplayName &&
        !!trimmedRegisterNumber,
      canUpdateExisting:
        isExistingTerminal &&
        isRegisterNumberSet &&
        !!fingerprintResult &&
        !fingerprintError &&
        !!trimmedDisplayName,
    };
  }, [
    displayName,
    existingTerminal,
    fingerprintError,
    fingerprintResult,
    registerNumber,
  ]);

  const offlineReadinessSignals = usePosSettingsOfflineReadiness({
    appSessionRecovery,
    existingTerminal,
    hasUser: Boolean(user),
    isAuthLoading,
    orgUrlSlug: routeParams?.orgUrlSlug,
    storeFactory,
    storeId: activeStore?._id,
    storeUrlSlug: routeParams?.storeUrlSlug,
  });
  const offlineReadiness = useMemo(
    () => buildPosOfflineReadinessSummary(offlineReadinessSignals),
    [offlineReadinessSignals],
  );

  const handleRegisterTerminal = async () => {
    if (!activeStore?._id) {
      toast.error("Missing active store context");
      return;
    }
    if (!fingerprintResult) {
      toast.error("Fingerprint not ready yet");
      return;
    }
    if (!registrationState.trimmedDisplayName) {
      toast.error("Display name is required");
      return;
    }
    if (!registrationState.trimmedRegisterNumber) {
      toast.error("Register number is required");
      return;
    }

    setIsRegistering(true);
    try {
      const result = await registerAndProvisionPosTerminal({
        activeStoreId: activeStore._id,
        browserInfo: fingerprintResult.browserInfo,
        displayName: registrationState.trimmedDisplayName,
        fingerprintHash: fingerprintResult.fingerprintHash,
        orgUrlSlug: routeParams?.orgUrlSlug,
        registerNumber: registrationState.trimmedRegisterNumber,
        requestPersistentStorage: requestDefaultPosLocalPersistentStorage,
        registerTerminalMutation,
        storeFactory,
        storeUrlSlug: routeParams?.storeUrlSlug,
        loginMode,
        transactionCapability,
      });
      if (result.kind === "user_error") {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        existingTerminal
          ? "Terminal register number configured"
          : "Terminal registered",
      );
      setNameTouched(false);
      setRegisterNumberTouched(false);
      setLoginModeTouched(false);
      setTransactionCapabilityTouched(false);
    } catch (error) {
      console.error(error);
      toast.error("Unable to register terminal");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleUpdateExistingTerminal = async () => {
    if (!existingTerminal || !registrationState.canUpdateExisting) {
      return;
    }
    if (!activeStore?._id) {
      toast.error("Missing active store context");
      return;
    }
    if (!fingerprintResult) {
      toast.error("Fingerprint not ready yet");
      return;
    }
    setIsUpdatingExisting(true);
    try {
      const result = await registerAndProvisionPosTerminal({
        activeStoreId: activeStore._id,
        browserInfo: fingerprintResult.browserInfo,
        displayName: registrationState.trimmedDisplayName,
        fingerprintHash: fingerprintResult.fingerprintHash,
        orgUrlSlug: routeParams?.orgUrlSlug,
        registerNumber: existingTerminal.registerNumber ?? "",
        requestPersistentStorage: requestDefaultPosLocalPersistentStorage,
        registerTerminalMutation,
        storeFactory,
        storeUrlSlug: routeParams?.storeUrlSlug,
        loginMode,
        transactionCapability,
      });
      if (result.kind === "user_error") {
        toast.error(result.error.message);
        return;
      }
      setNameTouched(false);
      setLoginModeTouched(false);
      setTransactionCapabilityTouched(false);
      toast.success("Terminal settings saved");
    } catch (error) {
      console.error(error);
      toast.error("Unable to save terminal settings");
    } finally {
      setIsUpdatingExisting(false);
    }
  };

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Point of sale"
            showBackButton
            title="POS settings"
            description="Configure the register details this checkout station uses before staff start in-store sales."
          />

          {isReadOnlyDemoSurface ? (
            <p className="mt-layout-md w-fit rounded-md border border-border bg-surface-raised px-layout-md py-layout-sm text-sm text-muted-foreground">
              POS settings are view-only in the demo.
            </p>
          ) : null}

          <section className="border-t border-border">
            <FingerprintRegistrationCard
              displayName={displayName}
              onDisplayNameChange={(value) => {
                setNameTouched(true);
                setDisplayName(value);
              }}
              registerNumber={registerNumber}
              onRegisterNumberChange={(value) => {
                setRegisterNumberTouched(true);
                setRegisterNumber(value);
              }}
              transactionCapability={transactionCapability}
              onTransactionCapabilityChange={(value) => {
                setTransactionCapabilityTouched(true);
                setTransactionCapability(value);
              }}
              loginMode={loginMode}
              onLoginModeChange={(value) => {
                setLoginModeTouched(true);
                setLoginMode(value);
              }}
              canRegister={registrationState.canRegister}
              onRegister={handleRegisterTerminal}
              isRegistering={isRegistering}
              isExistingTerminal={registrationState.isExistingTerminal}
              isRegisterNumberLocked={isRegisterNumberLocked}
              canUpdateExisting={registrationState.canUpdateExisting}
              onUpdateExisting={handleUpdateExistingTerminal}
              isUpdatingExisting={isUpdatingExisting}
              fingerprintError={!isFingerprintLoading ? fingerprintError : null}
              existingTerminalName={registrationState.existingTerminalName}
              existingTerminalRegisterNumber={
                registrationState.existingTerminalRegisterNumber
              }
              offlineReadiness={offlineReadiness}
              readOnly={isReadOnlyDemoSurface}
            />
          </section>

          <StoreDayAutomationAdminPanel
            readOnly={isReadOnlyDemoSurface}
            storeId={activeStore?._id ?? null}
          />

          <StoreHoursTimingReadout
            orgUrlSlug={routeParams?.orgUrlSlug}
            readOnly={isReadOnlyDemoSurface}
            storeId={activeStore?._id ?? null}
            storeUrlSlug={routeParams?.storeUrlSlug}
          />

          <RegisterCloseoutApprovalPolicyAdminPanel
            currency={activeStore?.currency ?? "GHS"}
            readOnly={isReadOnlyDemoSurface}
            storeId={activeStore?._id ?? null}
          />

          <EodCompletionAutomationAdminPanel
            currency={activeStore?.currency ?? "GHS"}
            readOnly={isReadOnlyDemoSurface}
            storeId={activeStore?._id ?? null}
          />

          {isReadOnlyDemoSurface ? null : (
            <POSRecoveryCodeAdminPanel storeId={activeStore?._id ?? null} />
          )}

          <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="space-y-layout-sm">
              <h2 className="text-2xl font-medium text-foreground">
                Terminal health
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Use the health console when you need the full roster, sync
                evidence, review work, or support notes for other checkout
                stations.
              </p>
            </div>

            <div className="flex flex-col items-start gap-layout-sm">
              <p className="text-sm text-muted-foreground">
                This settings page only changes the current checkout station.
              </p>
              {!isReadOnlyDemoSurface && routeParams?.orgUrlSlug && routeParams.storeUrlSlug ? (
                <Button asChild size="sm" variant="outline">
                  <HealthLink
                    params={{
                      orgUrlSlug: routeParams.orgUrlSlug,
                      storeUrlSlug: routeParams.storeUrlSlug,
                      ...(existingTerminal
                        ? { terminalId: String(existingTerminal._id) }
                        : {}),
                    }}
                    search={{ o: getOrigin() }}
                    to={
                      existingTerminal
                        ? "/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId"
                        : "/$orgUrlSlug/store/$storeUrlSlug/pos/terminals"
                    }
                  >
                    Open terminal health
                    <ArrowUpRight aria-hidden="true" />
                  </HealthLink>
                </Button>
              ) : !isReadOnlyDemoSurface ? (
                <p className="text-sm text-muted-foreground">
                  Select a store before opening terminal health.
                </p>
              ) : null}
            </div>
          </section>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
