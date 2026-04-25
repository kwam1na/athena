import { useState, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { hashPin } from "~/src/lib/security/pinHash";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";
import { presentCommandToast } from "~/src/lib/errors/presentCommandToast";
import { runCommand } from "~/src/lib/errors/runCommand";
import { PinInput } from "./PinInput";

interface CashierAuthDialogProps {
  open: boolean;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  onAuthenticated: (staffProfileId: Id<"staffProfile">) => void;
  onDismiss: () => void;
}

export const CashierAuthDialog = ({
  open,
  storeId,
  terminalId,
  onAuthenticated,
  onDismiss,
}: CashierAuthDialogProps) => {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [state, setState] = useState<"auth" | "signOut">("auth");
  const usernameInputRef = useRef<HTMLInputElement>(null);

  const authenticateStaffCredentialForTerminal = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForTerminal,
  );

  const expireAllSessionsForStaff = useMutation(
    api.inventory.posSessions.expireAllSessionsForStaff,
  );

  // Auto-focus username field when dialog opens
  useEffect(() => {
    if (open && usernameInputRef.current) {
      setTimeout(() => {
        usernameInputRef.current?.focus();
      }, 100);
    }
  }, [open]);

  // Auto-submit when PIN is complete
  useEffect(() => {
    if (pin.length === 6 && username.trim() && state === "auth") {
      handleSubmit();
    }
  }, [pin, state]);

  const showUnexpectedAuthFailure = () => {
    presentCommandToast({
      kind: "unexpected_error",
      error: {
        title: GENERIC_UNEXPECTED_ERROR_TITLE,
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
      },
    });
  };

  const handleSubmit = async () => {
    if (!username.trim()) {
      toast.error("Username required. Enter a username to continue.");
      return;
    }

    if (pin.length !== 6) {
      toast.error("PIN required. Enter all 6 digits to continue.");
      return;
    }

    setIsAuthenticating(true);
    try {
      // Hash the PIN client-side before calling the mutation
      const hashed = await hashPin(pin);

      const authenticationResult = await runCommand(() =>
        authenticateStaffCredentialForTerminal({
          allowedRoles: ["cashier", "manager"],
          username: username.trim(),
          pinHash: hashed,
          storeId,
          terminalId,
        }),
      );

      if (authenticationResult.kind !== "ok") {
        presentCommandToast(authenticationResult);
        setPin("");
        return;
      }

      const result = authenticationResult.data;

      if (result.staffProfileId) {
        const staffDisplayName =
          result.staffProfile.fullName ||
          [result.staffProfile.firstName, result.staffProfile.lastName]
            .filter(Boolean)
            .join(" ");

        if (state === "auth") {
          toast.success(`Signed in as ${staffDisplayName}.`);
          onAuthenticated(result.staffProfileId);
        } else {
          const expireResult = await expireAllSessionsForStaff({
            staffProfileId: result.staffProfileId,
            terminalId,
          });

          if (expireResult.success) {
            toast.success("Signed out from all registers.");
          } else {
            toast.error("Other register sign-outs not completed. Try again.");
            setPin("");
            return;
          }
          onAuthenticated(result.staffProfileId);
          setState("auth");
        }

        // Reset form
        setUsername("");
        setPin("");
      }
    } catch (error) {
      console.error(error);
      showUnexpectedAuthFailure();
      setPin("");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && username.trim() && pin.length === 6) {
      handleSubmit();
    }
  };

  const header =
    state === "auth"
      ? "Start register session"
      : "Sign out from other registers";

  const switchStateButtonText =
    state === "auth"
      ? "Sign out from other registers"
      : "Start register session";

  const mainButtonText =
    state === "auth" ? "Sign in" : "Sign out from all registers";

  return (
    <Dialog open={open} onOpenChange={onDismiss}>
      <DialogContent
        className="w-[620px] max-w-[1024px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{header}</DialogTitle>
        </DialogHeader>

        <div className="space-y-16 p-16">
          <div className="space-y-8">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                ref={usernameInputRef}
                id="username"
                className="w-[240px]"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isAuthenticating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pin">PIN</Label>
              <PinInput
                value={pin}
                onChange={setPin}
                disabled={isAuthenticating}
                onKeyDown={handleKeyDown}
                maxLength={6}
              />
            </div>
          </div>

          <div className="space-y-4">
            <LoadingButton
              onClick={handleSubmit}
              className="w-full p-8"
              variant="ghost"
              isLoading={isAuthenticating}
              disabled={!username.trim() || pin.length !== 6}
            >
              {mainButtonText}
            </LoadingButton>

            <Button
              onClick={() =>
                setState((prev) => (prev === "auth" ? "signOut" : "auth"))
              }
              className="w-full"
              variant="ghost"
            >
              {switchStateButtonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
