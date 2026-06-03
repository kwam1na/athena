import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { FadeIn } from "../../common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "../../common/PageLevelHeader";
import View from "../../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
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

type HealthLinkProps = {
  children: ReactNode;
  className?: string;
  params: {
    orgUrlSlug: string;
    storeUrlSlug: string;
  };
  to: string;
};

const HealthLink = Link as unknown as ComponentType<HealthLinkProps>;

type FingerprintRegistrationCardProps = {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  registerNumber: string;
  onRegisterNumberChange: (value: string) => void;
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
};

function FingerprintRegistrationCard({
  displayName,
  onDisplayNameChange,
  registerNumber,
  onRegisterNumberChange,
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

  return (
    <section className="grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">
          POS recovery code
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Manage the recovery code for the shared POS app account. Athena shows
          a new code only when it is created or rotated.
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

        {revealedCode ? (
          <div
            className="rounded-md border border-signal/30 bg-signal/10 px-layout-md py-layout-sm"
            role="status"
          >
            <p className="text-sm font-medium text-foreground">
              New recovery code
            </p>
            <p className="mt-layout-xs font-mono text-lg tracking-wide text-foreground">
              {revealedCode}
            </p>
            <p className="mt-layout-xs text-sm text-muted-foreground">
              Store this with the field operations runbook. It will not be shown
              again.
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
            <p>Shown only after rotate</p>
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

export function POSSettingsView({
  storeFactory,
}: {
  storeFactory?: Parameters<typeof registerAndProvisionPosTerminal>[0]["storeFactory"];
} = {}) {
  const { activeStore } = useGetActiveStore();
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
	        registerNumber: registrationState.trimmedRegisterNumber,
	        registerTerminalMutation,
	        storeFactory,
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
	        registerNumber: existingTerminal.registerNumber ?? "",
	        registerTerminalMutation,
	        storeFactory,
	      });
      if (result.kind === "user_error") {
        toast.error(result.error.message);
        return;
      }
      setNameTouched(false);
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
            />
          </section>

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
                  }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/pos/terminals"
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
