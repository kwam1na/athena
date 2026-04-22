import { useState, useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../ui/input-otp";
import { LoadingButton } from "../ui/loading-button";
import { toast } from "sonner";
import { hashPin } from "~/src/lib/security/pinHash";
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
    api.operations.staffCredentials.authenticateStaffCredentialForTerminal
  );

  const expireAllSessionsForStaff = useMutation(
    api.inventory.posSessions.expireAllSessionsForStaff
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

  const handleSubmit = async () => {
    if (!username.trim()) {
      toast.error("Please enter your username");
      return;
    }

    if (pin.length !== 6) {
      toast.error("Please enter your 6-digit PIN");
      return;
    }

    setIsAuthenticating(true);
    try {
      // Hash the PIN client-side before calling the mutation
      const hashed = await hashPin(pin);

      const result = await authenticateStaffCredentialForTerminal({
        allowedRoles: ["cashier", "manager"],
        username: username.trim(),
        pinHash: hashed,
        storeId,
        terminalId,
      });

      if (result.staffProfileId) {
        const staffDisplayName =
          result.staffProfile.fullName ||
          [result.staffProfile.firstName, result.staffProfile.lastName]
            .filter(Boolean)
            .join(" ");

        if (state === "auth") {
          toast.success(`Logged in as ${staffDisplayName}.`);
          onAuthenticated(result.staffProfileId);
        } else {
          const expireResult = await expireAllSessionsForStaff({
            staffProfileId: result.staffProfileId,
            terminalId,
          });

          if (expireResult.success) {
            toast.success("Signed out of all terminals");
          } else {
            toast.error("Failed to sign out of all terminals");
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
      toast.error((error as Error).message || "Authentication failed");
      console.error(error);
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
    state === "auth" ? "Start session" : "Sign out of all terminals";

  const switchStateButtonText =
    state === "auth" ? "Sign out of all terminals" : "Start session";

  const mainButtonText = state === "auth" ? "Sign In" : "Sign Out";

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
