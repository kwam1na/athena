import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { FadeIn } from "../../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
} from "../../common/PageLevelHeader";
import View from "../../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import {
  BrowserInfo,
  BrowserFingerprintResult,
  generateBrowserFingerprint,
} from "@/lib/browserFingerprint";
import { toast } from "sonner";
import { useAuth } from "~/src/hooks/useAuth";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";

type TerminalStatus = "active" | "revoked" | "lost";

type TerminalRecord = {
  _id: Id<"posTerminal">;
  _creationTime: number;
  storeId: Id<"store">;
  fingerprintHash: string;
  displayName: string;
  registerNumber?: string;
  registeredByUserId: Id<"athenaUser">;
  browserInfo: BrowserInfo;
  registeredAt: number;
  status: TerminalStatus;
};

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
        <h2 className="text-2xl font-medium text-foreground">
          Register setup
        </h2>
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
              Update terminal
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

export function POSSettingsView() {
  const { activeStore } = useGetActiveStore();

  const { user: currentUser } = useAuth();

  const registerTerminalMutation = useMutation(
    api.inventory.posTerminal.registerTerminal,
  );
  const updateTerminalMutation = useMutation(
    api.inventory.posTerminal.updateTerminal,
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
  ) as TerminalRecord | null | undefined;

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
        !!trimmedRegisterNumber &&
        (!isExistingTerminal || !isRegisterNumberSet),
      canUpdateExisting:
        isExistingTerminal &&
        isRegisterNumberSet &&
        !!trimmedDisplayName &&
        trimmedDisplayName !== existingTerminal?.displayName,
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
    if (!currentUser?._id) {
      toast.error("Unable to determine current user");
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
      const result = await registerTerminalMutation({
        storeId: activeStore._id,
        fingerprintHash: fingerprintResult.fingerprintHash,
        displayName: registrationState.trimmedDisplayName,
        registeredByUserId: currentUser._id,
        registerNumber: registrationState.trimmedRegisterNumber,
        browserInfo: fingerprintResult.browserInfo,
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
    setIsUpdatingExisting(true);
    try {
      await updateTerminalMutation({
        terminalId: existingTerminal._id,
        displayName: registrationState.trimmedDisplayName,
      });
      setNameTouched(false);
      toast.success("Terminal name updated");
    } catch (error) {
      console.error(error);
      toast.error("Unable to update terminal name");
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
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
