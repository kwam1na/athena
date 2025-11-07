import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import View from "../../View";
import { ComposedPageHeader, ViewHeader } from "../../common/PageHeader";
import { FadeIn } from "../../common/FadeIn";
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
  registeredByUserId: Id<"athenaUser">;
  browserInfo: BrowserInfo;
  registeredAt: number;
  status: TerminalStatus;
};

type FingerprintRegistrationCardProps = {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  canRegister: boolean;
  onRegister: () => void;
  isRegistering: boolean;
  isExistingTerminal: boolean;
  canUpdateExisting: boolean;
  onUpdateExisting: () => void;
  isUpdatingExisting: boolean;
  fingerprintError: string | null;
  existingTerminalName?: string | null;
};

function FingerprintRegistrationCard({
  displayName,
  onDisplayNameChange,
  canRegister,
  onRegister,
  isRegistering,
  isExistingTerminal,
  canUpdateExisting,
  onUpdateExisting,
  isUpdatingExisting,
  fingerprintError,
  existingTerminalName,
}: FingerprintRegistrationCardProps) {
  return (
    <View
      header={<ViewHeader title="Register terminal" />}
      hideHeaderBottomBorder
    >
      <div className="space-y-4 p-6">
        <div className="flex gap-4">
          <div className="space-y-2">
            <Label htmlFor="terminal-name">Terminal name</Label>
            <div className="flex gap-2">
              <Input
                id="terminal-name"
                placeholder="Front Counter Terminal"
                className="w-[300px]"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
              />
              {!isExistingTerminal && (
                <LoadingButton
                  onClick={onRegister}
                  isLoading={isRegistering}
                  disabled={!canRegister}
                >
                  Register
                </LoadingButton>
              )}
              {isExistingTerminal && (
                <LoadingButton
                  onClick={onUpdateExisting}
                  isLoading={isUpdatingExisting}
                  disabled={!canUpdateExisting || isUpdatingExisting}
                  variant="outline"
                >
                  Update terminal
                </LoadingButton>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {fingerprintError && (
            <p className="text-sm text-destructive">{fingerprintError}</p>
          )}

          {isExistingTerminal && existingTerminalName && (
            <p className="text-sm text-muted-foreground">
              This terminal is registered as
              <span className="font-semibold"> {existingTerminalName}</span>
            </p>
          )}
        </div>
      </div>
    </View>
  );
}

export function POSSettingsView() {
  const { activeStore } = useGetActiveStore();

  const { user: currentUser } = useAuth();

  const registerTerminalMutation = useMutation(
    api.inventory.posTerminal.registerTerminal
  );
  const updateTerminalMutation = useMutation(
    api.inventory.posTerminal.updateTerminal
  );

  const [fingerprintResult, setFingerprintResult] =
    useState<BrowserFingerprintResult | null>(null);
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);
  const [isFingerprintLoading, setIsFingerprintLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isUpdatingExisting, setIsUpdatingExisting] = useState(false);
  const fingerprintHash = fingerprintResult?.fingerprintHash;

  const currentTerminal = useQuery(
    api.inventory.posTerminal.getTerminalByFingerprint,
    activeStore?._id && fingerprintHash
      ? { storeId: activeStore._id, fingerprintHash }
      : "skip"
  ) as TerminalRecord | null | undefined;

  const existingTerminal = currentTerminal ?? null;

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
            stored
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
            JSON.stringify(result)
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFingerprintError(
            error instanceof Error
              ? error.message
              : "Unable to generate fingerprint"
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
    const isExistingTerminal = !!existingTerminal;

    return {
      trimmedDisplayName,
      isExistingTerminal,
      existingTerminalName: existingTerminal?.displayName ?? null,
      canRegister:
        !!fingerprintResult &&
        !fingerprintError &&
        !isExistingTerminal &&
        !!trimmedDisplayName,
      canUpdateExisting:
        isExistingTerminal &&
        !!trimmedDisplayName &&
        trimmedDisplayName !== existingTerminal?.displayName,
    };
  }, [displayName, existingTerminal, fingerprintError, fingerprintResult]);

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

    setIsRegistering(true);
    try {
      await registerTerminalMutation({
        storeId: activeStore._id,
        fingerprintHash: fingerprintResult.fingerprintHash,
        displayName: registrationState.trimmedDisplayName,
        registeredByUserId: currentUser._id,
        browserInfo: fingerprintResult.browserInfo,
      });
      toast.success("Terminal registered");
      setNameTouched(false);
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
    <View
      header={
        <ComposedPageHeader
          leadingContent={
            <div>
              <p className="text-lg font-semibold text-gray-900">
                POS Settings
              </p>
            </div>
          }
        />
      }
    >
      <FadeIn className="container mx-auto h-full w-full p-6">
        <div className="grid gap-6">
          <FingerprintRegistrationCard
            displayName={displayName}
            onDisplayNameChange={(value) => {
              setNameTouched(true);
              setDisplayName(value);
            }}
            canRegister={registrationState.canRegister}
            onRegister={handleRegisterTerminal}
            isRegistering={isRegistering}
            isExistingTerminal={registrationState.isExistingTerminal}
            canUpdateExisting={registrationState.canUpdateExisting}
            onUpdateExisting={handleUpdateExistingTerminal}
            isUpdatingExisting={isUpdatingExisting}
            fingerprintError={!isFingerprintLoading ? fingerprintError : null}
            existingTerminalName={registrationState.existingTerminalName}
          />
        </div>
      </FadeIn>
    </View>
  );
}
