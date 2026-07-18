import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { ATHENA_AUTH_SYNC_FAILED_EVENT } from "~/src/lib/constants";
import { startAthenaAuthSyncHandoff } from "./authSyncHandoff";

const POS_RECOVERY_ACCOUNT_EMAIL = "pos@wigclub.store";
const RECOVERY_FAILURE_COPY =
  "POS sign-in failed. Check the recovery code or ask an admin to confirm POS-only access.";

export function PosRecoveryCodeForm({
  onBack,
  orgUrlSlug,
  redirectTo,
  storeId,
  storeUrlSlug,
  terminalName,
}: {
  onBack: () => void;
  orgUrlSlug?: string | null;
  redirectTo?: string | null;
  storeId?: string | null;
  storeUrlSlug?: string | null;
  terminalName?: string | null;
}) {
  const [code, setCode] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isAuthHandoffPending, setIsAuthHandoffPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const signInInFlightRef = useRef(false);
  const { signIn } = useAuthActions();
  const normalizedTerminalName = terminalName?.trim();
  const recoveryInstructions = normalizedTerminalName
    ? `Sign in to ${normalizedTerminalName} with the recovery code.`
    : "Sign in the POS account with the recovery code.";

  useEffect(() => {
    const handleAuthSyncFailed = () => {
      signInInFlightRef.current = false;
      setIsSigningIn(false);
      setIsAuthHandoffPending(false);
    };

    window.addEventListener(
      ATHENA_AUTH_SYNC_FAILED_EVENT,
      handleAuthSyncFailed,
    );
    return () =>
      window.removeEventListener(
        ATHENA_AUTH_SYNC_FAILED_EVENT,
        handleAuthSyncFailed,
      );
  }, []);

  const canSubmit =
    Boolean(storeId || (orgUrlSlug && storeUrlSlug)) &&
    code.trim().length > 0 &&
    !isSigningIn &&
    !isAuthHandoffPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canSubmit ||
      signInInFlightRef.current ||
      (!storeId && (!orgUrlSlug || !storeUrlSlug))
    ) {
      return;
    }

    try {
      signInInFlightRef.current = true;
      setIsSigningIn(true);
      setErrorMessage(null);

      const payload: Record<string, string> = {
        code: code.trim(),
        email: POS_RECOVERY_ACCOUNT_EMAIL,
      };
      if (storeId) {
        payload.storeId = storeId;
      }
      if (orgUrlSlug && storeUrlSlug) {
        payload.orgUrlSlug = orgUrlSlug;
        payload.storeUrlSlug = storeUrlSlug;
      }

      const result = await signIn(
        ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
        payload,
      );

      if (!result.signingIn) {
        setErrorMessage(RECOVERY_FAILURE_COPY);
        signInInFlightRef.current = false;
        setIsSigningIn(false);
        setIsAuthHandoffPending(false);
        return;
      }

      startAthenaAuthSyncHandoff(redirectTo);
      setIsAuthHandoffPending(true);
      setIsSigningIn(false);
    } catch {
      setErrorMessage(RECOVERY_FAILURE_COPY);
      signInInFlightRef.current = false;
      setIsSigningIn(false);
      setIsAuthHandoffPending(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-layout-lg">
      <div className="space-y-layout-md">
        <h2 className="bg-background font-display text-2xl font-light uppercase tracking-[0.18em] text-foreground">
          POS recovery
        </h2>
        <p className="w-fit bg-background text-sm leading-6 text-muted-foreground">
          {recoveryInstructions}
        </p>
        <button
          type="button"
          className="group inline-flex items-center gap-layout-xs text-sm text-muted-foreground underline-offset-4 transition-colors duration-standard ease-standard hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-standard ease-emphasized group-hover:-translate-x-1 group-focus-visible:-translate-x-1" />
          Use email code
        </button>
      </div>

      <form
        className="relative flex w-full flex-col items-start gap-layout-md overflow-hidden rounded-lg border border-none bg-background p-layout-xs before:pointer-events-none before:absolute before:inset-0"
        onSubmit={handleSubmit}
      >
        <div className="relative z-10 flex w-full flex-col gap-layout-sm">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="pos-recovery-code"
          >
            Recovery code
          </label>
          <Input
            id="pos-recovery-code"
            autoComplete="off"
            autoCapitalize="none"
            inputMode="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="h-control-standard border-border/80 bg-background shadow-[inset_0_1px_0_hsl(var(--background)/0.85)]"
          />
        </div>

        <div className="relative z-10 min-h-5 px-layout-xs">
          {errorMessage ? (
            <span className="text-sm text-destructive">{errorMessage}</span>
          ) : null}
          {!storeId && (!orgUrlSlug || !storeUrlSlug) ? (
            <span className="text-sm text-muted-foreground">
              Open recovery from the store login route.
            </span>
          ) : null}
        </div>

        <LoadingButton
          isLoading={isSigningIn}
          disabled={!canSubmit}
          type="submit"
          variant="default"
          className="group relative z-10 h-control-standard w-fit shadow-[0_16px_34px_-22px_hsl(var(--primary)/0.72)]"
        >
          Continue
          <ArrowRight className="h-4 w-4 transition-transform duration-standard ease-emphasized group-hover:translate-x-1 group-focus-visible:translate-x-1" />
        </LoadingButton>
      </form>
    </div>
  );
}
