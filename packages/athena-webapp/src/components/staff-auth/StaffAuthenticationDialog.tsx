import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PinInput } from "@/components/pos/PinInput";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/loading-button";
import { type NormalizedCommandResult } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { hashPin } from "@/lib/security/pinHash";
import type { Id } from "~/convex/_generated/dataModel";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";

export type StaffAuthMode = "authenticate" | "recover";

export type StaffAuthenticationResult = {
  staffProfile: {
    firstName?: string | null;
    fullName?: string | null;
    lastName?: string | null;
  };
  staffProfileId: Id<"staffProfile">;
};

export type StaffAuthenticationDialogCopy = {
  title: string;
  description: string;
  submitLabel: string;
};

export type StaffAuthenticationDialogProps = {
  alternateCopy?: StaffAuthenticationDialogCopy;
  alternateTriggerLabel?: string;
  copy: StaffAuthenticationDialogCopy;
  getSuccessMessage?: (
    result: StaffAuthenticationResult,
    mode: StaffAuthMode,
  ) => string | null;
  onAuthenticate: (args: {
    mode: StaffAuthMode;
    pinHash: string;
    username: string;
  }) => Promise<NormalizedCommandResult<StaffAuthenticationResult>>;
  onAuthenticated: (
    result: StaffAuthenticationResult,
    mode: StaffAuthMode,
  ) => void;
  onDismiss: () => void;
  open: boolean;
  returnTriggerLabel?: string;
};

export function StaffAuthenticationDialog({
  alternateCopy,
  alternateTriggerLabel,
  copy,
  getSuccessMessage,
  onAuthenticate,
  onAuthenticated,
  onDismiss,
  open,
  returnTriggerLabel,
}: StaffAuthenticationDialogProps) {
  const [mode, setMode] = useState<StaffAuthMode>("authenticate");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const activeCopy = mode === "recover" && alternateCopy ? alternateCopy : copy;
  const canSubmit = username.trim().length > 0 && pin.length === 6;

  useEffect(() => {
    if (!open) {
      setMode("authenticate");
      setUsername("");
      setPin("");
      return;
    }

    const focusTimer = window.setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 100);

    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (canSubmit && mode === "authenticate") {
      void handleSubmit();
    }
  }, [canSubmit, mode]);

  async function handleSubmit() {
    if (!username.trim()) {
      toast.error("Username required. Enter a username to continue.");
      return;
    }

    if (pin.length !== 6) {
      toast.error("PIN required. Enter all 6 digits to continue.");
      return;
    }

    setIsAuthenticating(true);

    let result: NormalizedCommandResult<StaffAuthenticationResult>;

    try {
      const pinHash = await hashPin(pin);

      result = await onAuthenticate({
        mode,
        pinHash,
        username: username.trim(),
      });
    } catch (error) {
      console.error(error);
      result = {
        kind: "unexpected_error",
        error: {
          title: GENERIC_UNEXPECTED_ERROR_TITLE,
          message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
        },
      };
    }

    setIsAuthenticating(false);

    if (result.kind !== "ok") {
      presentCommandToast(result);
      setPin("");
      return;
    }

    const successMessage = getSuccessMessage?.(result.data, mode);
    if (successMessage) {
      toast.success(successMessage);
    }

    onAuthenticated(result.data, mode);
    setUsername("");
    setPin("");
    setMode("authenticate");
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && canSubmit) {
      void handleSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent
        className="w-[min(calc(100vw-2rem),34rem)] gap-0 p-0"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="space-y-layout-xl p-layout-lg">
          <DialogHeader className="space-y-layout-xs text-left">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
              Staff authentication
            </p>
            <DialogTitle>{activeCopy.title}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {activeCopy.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-layout-lg">
            <div className="max-w-72 space-y-layout-xs">
              <Label htmlFor="staff-auth-username">Username</Label>
              <Input
                ref={usernameInputRef}
                id="staff-auth-username"
                placeholder="Enter username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAuthenticating}
              />
            </div>

            <div className="space-y-layout-xs">
              <Label htmlFor="staff-auth-pin">PIN</Label>
              <PinInput
                value={pin}
                onChange={setPin}
                disabled={isAuthenticating}
                onKeyDown={handleKeyDown}
                maxLength={6}
                size="sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-layout-sm border-t pt-layout-lg sm:flex-row sm:items-center sm:justify-between">
            {alternateCopy && alternateTriggerLabel ? (
              <button
                type="button"
                className="text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => {
                  setMode((currentMode) =>
                    currentMode === "authenticate" ? "recover" : "authenticate",
                  );
                  setPin("");
                }}
                disabled={isAuthenticating}
              >
                {mode === "authenticate"
                  ? alternateTriggerLabel
                  : returnTriggerLabel ?? copy.title}
              </button>
            ) : (
              <span />
            )}

            <LoadingButton
              onClick={handleSubmit}
              isLoading={isAuthenticating}
              disabled={!canSubmit || isAuthenticating}
            >
              {activeCopy.submitLabel}
            </LoadingButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
