import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { ComponentType, ReactNode } from "react";
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
  buildPosOfflineReadinessSummary,
  type PosOfflineReadinessInput,
  type PosOfflineReadinessSummary,
} from "@/offline/posOfflineReadiness";
import { readPosAppShellReadiness } from "@/offline/posAppShellReadiness";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "@/lib/pos/infrastructure/local/posLocalStore";
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
const DEFAULT_STORE_DAY_AUTO_START_MINUTES = 8 * 60;
const DEFAULT_STORE_DAY_TIMEZONE_OFFSET_MINUTES = 0;
const STORE_DAY_AUTOMATION_HOURS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);
const STORE_DAY_AUTOMATION_MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);
type StoreDayAutomationPeriod = "AM" | "PM";
type AutomationPolicyMode = "disabled" | "dry_run" | "enabled";
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
                className="flex min-h-[6.5rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-action-commit has-[:checked]:bg-action-neutral-soft"
                key={option.value}
              >
                <span className="flex items-start gap-layout-xs">
                  <RadioGroupItem
                    aria-label={option.label}
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
            className="grid gap-layout-sm sm:grid-cols-2"
            value={loginMode}
            onValueChange={(value) =>
              onLoginModeChange(normalizePosTerminalLoginMode(value))
            }
          >
            {terminalLoginModeOptions.map((option) => (
              <label
                className="flex min-h-[5.75rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-action-commit has-[:checked]:bg-action-neutral-soft"
                key={option.value}
              >
                <span className="flex items-start gap-layout-xs">
                  <RadioGroupItem
                    aria-label={option.label}
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
              disabled={!canUpdateExisting || isUpdatingExisting}
              variant="default"
            >
              Save terminal settings
            </LoadingButton>
          ) : (
            <LoadingButton
              onClick={onRegister}
              isLoading={isRegistering}
              disabled={!canRegister || isRegistering}
              variant="default"
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
              {offlineReadiness.readyCount} of{" "}
              {offlineReadiness.signals.length} reporting
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
  openingBlockerHandling?: "skip_when_blocked" | "start_with_manager_review" | null;
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

function formatLocalStartTime(minutes?: number | null) {
  const safeMinutes =
    typeof minutes === "number" && minutes >= 0 && minutes < 24 * 60
      ? minutes
      : DEFAULT_STORE_DAY_AUTO_START_MINUTES;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getLocalStartTimeParts(value: string) {
  const parsedMinutes = parseLocalStartMinutes(value);
  const safeMinutes = parsedMinutes ?? DEFAULT_STORE_DAY_AUTO_START_MINUTES;
  const hour24 = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  const period: StoreDayAutomationPeriod = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return {
    hour: String(hour12).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
    period,
  };
}

function formatLocalStartTimeFromParts(args: {
  hour: string;
  minute: string;
  period: StoreDayAutomationPeriod;
}) {
  const hour12 = Number(args.hour);
  const minute = Number(args.minute);

  if (
    !Number.isInteger(hour12) ||
    hour12 < 1 ||
    hour12 > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return formatLocalStartTime(DEFAULT_STORE_DAY_AUTO_START_MINUTES);
  }

  const hour24 =
    args.period === "PM"
      ? hour12 === 12
        ? 12
        : hour12 + 12
      : hour12 === 12
        ? 0
        : hour12;

  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseLocalStartMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

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

function EodCompletionAutomationAdminPanel({
  storeId,
}: {
  storeId?: Id<"store"> | null;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const policy = useQuery(
    api.operations.dailyOperationsAutomation.getEodAutoCompletePolicy,
    !isLoading && hasFullAdminAccess && storeId
      ? { storeId }
      : "skip",
  ) as EodAutoCompletePolicy | null | undefined;
  const updateEodAutoCompletePolicy = useMutation(
    api.operations.dailyOperationsAutomation.updateEodAutoCompletePolicy,
  );
  const [mode, setMode] = useState<AutomationPolicyMode>("disabled");
  const [cleanDayAutoCompleteEnabled, setCleanDayAutoCompleteEnabled] =
    useState(false);
  const [localCompletionWindow, setLocalCompletionWindow] = useState(
    formatLocalStartTime(0),
  );
  const [maxAbsoluteCashVariance, setMaxAbsoluteCashVariance] = useState("0");
  const [maxVoidedSaleCount, setMaxVoidedSaleCount] = useState("0");
  const [maxVoidedSaleTotal, setMaxVoidedSaleTotal] = useState("0");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const policyMode = policy?.mode;
  const policyCleanDayAutoCompleteEnabled =
    policy?.cleanDayAutoCompleteEnabled;
  const policyLocalCompletionWindowMinutes =
    policy?.localCompletionWindowMinutes;
  const policyMaxAbsoluteCashVariance = policy?.maxAbsoluteCashVariance;
  const policyMaxVoidedSaleCount = policy?.maxVoidedSaleCount;
  const policyMaxVoidedSaleTotal = policy?.maxVoidedSaleTotal;

  useEffect(() => {
    if (
      policyMode == null &&
      policyCleanDayAutoCompleteEnabled == null &&
      policyLocalCompletionWindowMinutes == null &&
      policyMaxAbsoluteCashVariance == null &&
      policyMaxVoidedSaleCount == null &&
      policyMaxVoidedSaleTotal == null
    ) {
      return;
    }

    setMode(normalizeAutomationPolicyMode(policyMode));
    setCleanDayAutoCompleteEnabled(
      Boolean(policyCleanDayAutoCompleteEnabled),
    );
    setLocalCompletionWindow(
      formatLocalStartTime(policyLocalCompletionWindowMinutes),
    );
    setMaxAbsoluteCashVariance(String(policyMaxAbsoluteCashVariance ?? 0));
    setMaxVoidedSaleCount(String(policyMaxVoidedSaleCount ?? 0));
    setMaxVoidedSaleTotal(String(policyMaxVoidedSaleTotal ?? 0));
  }, [
    policyCleanDayAutoCompleteEnabled,
    policyLocalCompletionWindowMinutes,
    policyMaxAbsoluteCashVariance,
    policyMaxVoidedSaleCount,
    policyMaxVoidedSaleTotal,
    policyMode,
  ]);

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const localCompletionWindowMinutes = parseLocalStartMinutes(
    localCompletionWindow,
  );
  const parsedMaxAbsoluteCashVariance = parseNonNegativeIntegerInput(
    maxAbsoluteCashVariance,
  );
  const parsedMaxVoidedSaleCount = parseNonNegativeIntegerInput(
    maxVoidedSaleCount,
  );
  const parsedMaxVoidedSaleTotal = parseNonNegativeIntegerInput(
    maxVoidedSaleTotal,
  );
  const localCompletionWindowParts = getLocalStartTimeParts(
    localCompletionWindow,
  );
  const canSave =
    Boolean(storeId) &&
    localCompletionWindowMinutes !== null &&
    parsedMaxAbsoluteCashVariance !== null &&
    parsedMaxVoidedSaleCount !== null &&
    parsedMaxVoidedSaleTotal !== null &&
    !isSaving;

  const updateLocalCompletionWindowPart = (
    key: keyof typeof localCompletionWindowParts,
    value: string,
  ) => {
    setLocalCompletionWindow(
      formatLocalStartTimeFromParts({
        ...localCompletionWindowParts,
        [key]: value,
      }),
    );
  };

  const handleSave = async () => {
    if (!storeId) {
      setMessage({
        kind: "error",
        text: "Select a store before saving EOD completion automation.",
      });
      return;
    }

    if (
      localCompletionWindowMinutes === null ||
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
        localCompletionWindowMinutes,
        maxAbsoluteCashVariance: parsedMaxAbsoluteCashVariance,
        maxVoidedSaleCount: parsedMaxVoidedSaleCount,
        maxVoidedSaleTotal: parsedMaxVoidedSaleTotal,
        mode,
        operatingTimezoneOffsetMinutes: DEFAULT_STORE_DAY_TIMEZONE_OFFSET_MINUTES,
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
          className="grid gap-layout-sm sm:grid-cols-3"
          value={mode}
          onValueChange={(value) =>
            setMode(normalizeAutomationPolicyMode(value as AutomationPolicyMode))
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
              description: "Athena completes eligible EOD Reviews under policy.",
            },
          ].map((option) => (
            <label
              className="flex min-h-[6.5rem] cursor-pointer flex-col gap-layout-xs rounded-md border border-border bg-background p-layout-sm text-sm transition-colors has-[:checked]:border-action-commit has-[:checked]:bg-action-neutral-soft"
              key={option.value}
              onMouseDown={() => setMode(option.value as AutomationPolicyMode)}
            >
              <span className="flex items-start gap-layout-xs">
                <RadioGroupItem
                  aria-label={option.label}
                  onClick={() =>
                    setMode(option.value as AutomationPolicyMode)
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

        <div className="grid gap-layout-md lg:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="flex min-h-[5rem] items-start gap-layout-sm rounded-md border border-border bg-background p-layout-sm text-sm">
            <Checkbox
              aria-label="Enable clean-day completion"
              checked={cleanDayAutoCompleteEnabled}
              className="mt-1"
              onCheckedChange={(checked) =>
                setCleanDayAutoCompleteEnabled(checked === true)
              }
            />
            <span>
              <span className="block font-medium text-foreground">
                Enable clean-day completion
              </span>
              <span className="mt-1 block leading-5 text-muted-foreground">
                Athena can complete days with no blockers, carry-forward items,
                or review evidence when automation is enabled.
              </span>
            </span>
          </label>

          <div className="space-y-layout-xs">
            <Label>Local completion window</Label>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-layout-2xs">
              <Select
                onValueChange={(value) =>
                  updateLocalCompletionWindowPart("hour", value)
                }
                value={localCompletionWindowParts.hour}
              >
                <SelectTrigger
                  aria-label="EOD completion hour"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORE_DAY_AUTOMATION_HOURS.map((hour) => (
                    <SelectItem key={hour} value={hour}>
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(value) =>
                  updateLocalCompletionWindowPart("minute", value)
                }
                value={localCompletionWindowParts.minute}
              >
                <SelectTrigger
                  aria-label="EOD completion minute"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORE_DAY_AUTOMATION_MINUTES.map((minute) => (
                    <SelectItem key={minute} value={minute}>
                      {minute}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(value) =>
                  updateLocalCompletionWindowPart(
                    "period",
                    value as StoreDayAutomationPeriod,
                  )
                }
                value={localCompletionWindowParts.period}
              >
                <SelectTrigger
                  aria-label="EOD completion period"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Athena checks completion after this store-local time.
            </p>
          </div>
        </div>

        <div className="grid gap-layout-md sm:grid-cols-3">
          <div className="space-y-layout-xs">
            <Label htmlFor="eod-cash-variance-threshold">
              Cash variance threshold
            </Label>
            <Input
              id="eod-cash-variance-threshold"
              min={0}
              onChange={(event) =>
                setMaxAbsoluteCashVariance(event.target.value)
              }
              type="number"
              value={maxAbsoluteCashVariance}
            />
          </div>
          <div className="space-y-layout-xs">
            <Label htmlFor="eod-voided-sale-count-threshold">
              Voided sale count threshold
            </Label>
            <Input
              id="eod-voided-sale-count-threshold"
              min={0}
              onChange={(event) => setMaxVoidedSaleCount(event.target.value)}
              type="number"
              value={maxVoidedSaleCount}
            />
          </div>
          <div className="space-y-layout-xs">
            <Label htmlFor="eod-voided-sale-total-threshold">
              Voided sale total threshold
            </Label>
            <Input
              id="eod-voided-sale-total-threshold"
              min={0}
              onChange={(event) => setMaxVoidedSaleTotal(event.target.value)}
              type="number"
              value={maxVoidedSaleTotal}
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
            disabled={!canSave}
            isLoading={isSaving}
            onClick={handleSave}
            variant="default"
          >
            Save EOD completion automation
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

function StoreDayAutomationAdminPanel({
  storeId,
}: {
  storeId?: Id<"store"> | null;
}) {
  const { hasFullAdminAccess, isLoading } = usePermissions();
  const policy = useQuery(
    api.operations.dailyOperationsAutomation.getOpeningAutoStartPolicy,
    !isLoading && hasFullAdminAccess && storeId ? { storeId } : "skip",
  ) as StoreDayAutomationPolicy | null | undefined;
  const updateOpeningAutoStartPolicy = useMutation(
    api.operations.dailyOperationsAutomation.updateOpeningAutoStartPolicy,
  );
  const [isEnabled, setIsEnabled] = useState(false);
  const [localStartTime, setLocalStartTime] = useState(
    formatLocalStartTime(DEFAULT_STORE_DAY_AUTO_START_MINUTES),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const policyLocalStartMinutes = policy?.localStartMinutes;
  const policyMode = policy?.mode;

  useEffect(() => {
    if (policyLocalStartMinutes == null && policyMode == null) {
      return;
    }

    setIsEnabled(policyMode === "enabled");
    setLocalStartTime(formatLocalStartTime(policyLocalStartMinutes));
  }, [policyLocalStartMinutes, policyMode]);

  if (isLoading || !hasFullAdminAccess) {
    return null;
  }

  const localStartMinutes = parseLocalStartMinutes(localStartTime);
  const canSave =
    Boolean(storeId) && localStartMinutes !== null && !isSaving;
  const localStartTimeParts = getLocalStartTimeParts(localStartTime);

  const updateLocalStartTimePart = (
    key: keyof typeof localStartTimeParts,
    value: string,
  ) => {
    setLocalStartTime(
      formatLocalStartTimeFromParts({
        ...localStartTimeParts,
        [key]: value,
      }),
    );
  };

  const handleSave = async () => {
    const parsedStartMinutes = parseLocalStartMinutes(localStartTime);

    if (!storeId) {
      setMessage({
        kind: "error",
        text: "Select a store before saving store-day automation.",
      });
      return;
    }

    if (parsedStartMinutes === null) {
      setMessage({
        kind: "error",
        text: "Enter a valid local start time.",
      });
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      await updateOpeningAutoStartPolicy({
        localStartMinutes: parsedStartMinutes,
        mode: isEnabled ? "enabled" : "disabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: DEFAULT_STORE_DAY_TIMEZONE_OFFSET_MINUTES,
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

        <div className="grid gap-layout-md sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="flex min-h-[5rem] items-start gap-layout-sm rounded-md border border-border bg-background p-layout-sm text-sm">
            <Checkbox
              aria-label="Enable store-day auto-start"
              checked={isEnabled}
              className="mt-1"
              onCheckedChange={(checked) => setIsEnabled(checked === true)}
            />
            <span>
              <span className="block font-medium text-foreground">
                Enable store-day auto-start
              </span>
              <span className="mt-1 block leading-5 text-muted-foreground">
                Athena starts Opening Handoff at the saved local time. Review
                items are not resolved by automation.
              </span>
            </span>
          </label>

          <div className="space-y-layout-xs">
            <Label>Local start time</Label>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-layout-2xs">
              <Select
                onValueChange={(value) =>
                  updateLocalStartTimePart("hour", value)
                }
                value={localStartTimeParts.hour}
              >
                <SelectTrigger
                  aria-label="Store day start hour"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORE_DAY_AUTOMATION_HOURS.map((hour) => (
                    <SelectItem key={hour} value={hour}>
                      {hour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(value) =>
                  updateLocalStartTimePart("minute", value)
                }
                value={localStartTimeParts.minute}
              >
                <SelectTrigger
                  aria-label="Store day start minute"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORE_DAY_AUTOMATION_MINUTES.map((minute) => (
                    <SelectItem key={minute} value={minute}>
                      {minute}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                onValueChange={(value) =>
                  updateLocalStartTimePart(
                    "period",
                    value as StoreDayAutomationPeriod,
                  )
                }
                value={localStartTimeParts.period}
              >
                <SelectTrigger
                  aria-label="Store day start period"
                  className="bg-background"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved as store-local minutes for the scheduled automation check.
            </p>
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
            disabled={!canSave}
            isLoading={isSaving}
            onClick={handleSave}
            variant="default"
          >
            Save store-day automation
          </LoadingButton>
        </div>
      </div>
    </section>
  );
}

function POSRecoveryCodeAdminPanel({
  storeId,
}: {
  storeId?: string | null;
}) {
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
            className="rounded-md border border-signal/30 bg-signal/10 px-layout-md py-layout-sm"
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
            variant="default"
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
            disabled={!storeId || !status || status.status === "revoked" || isRevoking}
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

type PosSettingsLocalReadinessStore = ReturnType<typeof createPosLocalStore>;

function createDefaultLocalReadinessStore() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return createPosLocalStore({
    adapter: createIndexedDbPosLocalStorageAdapter(),
  });
}

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
  storeFactory?: Parameters<typeof registerAndProvisionPosTerminal>[0]["storeFactory"];
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
        store.readProvisionedTerminalSeed?.() ??
          Promise.resolve({ ok: true as const, value: null }),
        store.getStaffAuthorityReadiness?.({
          storeId,
          terminalId: existingTerminal._id,
        }) ?? Promise.resolve({ ok: true as const, value: "missing" as const }),
        store.readRegisterCatalogSnapshot?.({ storeId }) ??
          Promise.resolve({ ok: true as const, value: null }),
        store.readRegisterServiceCatalogSnapshot?.({ storeId }) ??
          Promise.resolve({ ok: true as const, value: null }),
        store.readRegisterAvailabilitySnapshot?.({ storeId }) ??
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
  storeFactory,
}: {
  storeFactory?: Parameters<typeof registerAndProvisionPosTerminal>[0]["storeFactory"];
} = {}) {
  const { activeStore } = useGetActiveStore();
  const { isLoading: isAuthLoading, user } = useAuth();
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
            />
          </section>

          <StoreDayAutomationAdminPanel storeId={activeStore?._id ?? null} />

          <EodCompletionAutomationAdminPanel storeId={activeStore?._id ?? null} />

          <POSRecoveryCodeAdminPanel storeId={activeStore?._id ?? null} />

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
              {routeParams?.orgUrlSlug && routeParams.storeUrlSlug ? (
                <HealthLink
                  className="inline-flex h-control-compact items-center rounded-md bg-signal px-layout-md text-sm font-medium text-signal-foreground"
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
                </HealthLink>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a store before opening terminal health.
                </p>
              )}
            </div>
          </section>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
