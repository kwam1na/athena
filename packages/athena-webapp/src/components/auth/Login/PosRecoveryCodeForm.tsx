import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getDefaultAuthRuntimeHandoffCoordinator,
  type AuthRuntimeHandoffCoordinator,
} from "../../../lib/auth/authRuntimeHandoff";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import {
  clearPosTerminalReconnectIntent,
  writePosTerminalReconnectIntent,
} from "../../../lib/pos/application/posTerminalReconnectIntent";
import {
  abortPosRecoveryFlow,
  activatePosRecoveryFlow,
  issuePosRecoveryFlow,
  resumePosRecoveryFlow,
  startPosRecoveryFlow,
  verifyPromotedPosRecoveryFlow,
  type PosRecoveryFlowPhase,
  type PosRecoveryFlowSession,
  type PosRecoveryFrontendAdapter,
} from "./posRecoveryFlow";

const RECOVERY_FAILURE_COPY =
  "This checkout station could not be signed in. Check the code and try again.";

export type PosRecoveryTerminalEvidence = {
  browserFingerprintHash: string;
  displayName: string;
  storeName: string;
  terminalId: string;
  terminalProof: string;
};

export function PosRecoveryCodeForm({
  adapter,
  authRuntime = getDefaultAuthRuntimeHandoffCoordinator(),
  onBack,
  onUseAdministratorEmail,
  redirectTo = "/",
  terminal,
}: {
  adapter: PosRecoveryFrontendAdapter;
  authRuntime?: AuthRuntimeHandoffCoordinator;
  onBack: () => void;
  onUseAdministratorEmail: () => void;
  redirectTo?: string | null;
  terminal: PosRecoveryTerminalEvidence | null;
}) {
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<
    | "idle"
    | PosRecoveryFlowPhase
    | "retry_issue"
    | "retry_activation"
    | "retry_verification"
    | "aborting"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preflightAttempt, setPreflightAttempt] = useState(0);
  const [preflightState, setPreflightState] = useState<
    "checking" | "disconnected" | "failed" | "recovery_code"
  >(terminal ? "checking" : "failed");
  const sessionRef = useRef<PosRecoveryFlowSession | null>(null);
  const startupResumeAttemptedRef = useRef(false);

  const browserFingerprintHash = terminal?.browserFingerprintHash;
  const hasTerminalEvidence = terminal !== null;
  const terminalId = terminal?.terminalId;
  const terminalProof = terminal?.terminalProof;
  const updatePhase = useCallback((next: PosRecoveryFlowPhase) => {
    setPhase(next);
    setErrorMessage(null);
  }, []);
  useEffect(() => {
    if (!browserFingerprintHash || !terminalId || !terminalProof) {
      if (hasTerminalEvidence) setPreflightState("failed");
      return;
    }
    let cancelled = false;
    setPreflightState("checking");
    void adapter
      .requestDisposition({
        browserFingerprintHash,
        terminalId,
        terminalProof,
      })
      .then((disposition) => {
        if (cancelled) return;
        if (disposition.disposition === "recovery_code_required") {
          clearPosTerminalReconnectIntent();
          setPreflightState("recovery_code");
          return;
        }
        if (
          writePosTerminalReconnectIntent({
            expiresAt: disposition.expiresAt,
            reconnectIntentToken: disposition.reconnectIntentToken,
          })
        ) {
          setPreflightState("disconnected");
          return;
        }
        setPreflightState("failed");
      })
      .catch(() => {
        if (!cancelled) setPreflightState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    browserFingerprintHash,
    hasTerminalEvidence,
    preflightAttempt,
    terminalId,
    terminalProof,
  ]);

  useEffect(() => {
    if (
      preflightState !== "recovery_code" ||
      !terminal ||
      startupResumeAttemptedRef.current
    ) {
      return;
    }
    const runtimePhase = authRuntime.getSnapshot().handoffPhase;
    if (
      runtimePhase !== "prepared" &&
      runtimePhase !== "auth_issued" &&
      runtimePhase !== "activated"
    ) {
      return;
    }
    startupResumeAttemptedRef.current = true;
    const session: PosRecoveryFlowSession = {
      handle: authRuntime.getCurrentHandoffHandle(),
      redirectTo: redirectTo ?? "/",
      terminalId: terminal.terminalId,
      terminalProof: terminal.terminalProof,
    };
    sessionRef.current = session;
    let cancelled = false;
    void resumePosRecoveryFlow({
      adapter,
      coordinator: authRuntime,
      onPhase: (next) => {
        if (!cancelled) updatePhase(next);
      },
      session,
    })
      .then((result) => {
        if (cancelled || result.status !== "code_required") return;
        setPhase("retry_issue");
        setErrorMessage(
          "Enter the recovery code again to continue this sign-in.",
        );
      })
      .catch(() => {
        if (cancelled) return;
        const currentPhase = authRuntime.getSnapshot().handoffPhase;
        setPhase(
          currentPhase === "promoted"
            ? "retry_verification"
            : currentPhase === "activated"
              ? "retry_activation"
              : currentPhase === "auth_issued"
                ? "retry_activation"
                : "retry_issue",
        );
        setErrorMessage(RECOVERY_FAILURE_COPY);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, authRuntime, preflightState, redirectTo, terminal, updatePhase]);

  if (!terminal) {
    return (
      <section
        className="flex w-full flex-col gap-layout-lg"
        aria-labelledby="pos-setup-title"
      >
        <div className="space-y-layout-md">
          <h2
            id="pos-setup-title"
            className="font-display text-2xl font-light uppercase tracking-[0.18em]"
          >
            Checkout station setup required
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This browser is not registered as a checkout station. Ask a store
            administrator to finish setup here.
          </p>
        </div>
        <button
          type="button"
          className="w-fit text-sm underline"
          onClick={onUseAdministratorEmail}
        >
          Sign in as administrator
        </button>
      </section>
    );
  }

  if (preflightState === "checking") {
    return <p role="status">Checking this checkout station…</p>;
  }

  if (preflightState === "disconnected") {
    return (
      <section className="flex w-full flex-col gap-layout-lg">
        <div className="space-y-layout-md">
          <h2 className="font-display text-2xl font-light uppercase tracking-[0.18em]">
            Checkout station disconnected
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            This checkout station was disconnected and needs a store
            administrator to reconnect it. POS recovery cannot continue yet.
          </p>
        </div>
        <button
          type="button"
          className="w-fit text-sm underline"
          onClick={onUseAdministratorEmail}
        >
          Sign in as administrator
        </button>
      </section>
    );
  }

  if (preflightState === "failed") {
    return (
      <section className="flex w-full flex-col gap-layout-lg">
        <div className="space-y-layout-md">
          <h2 className="font-display text-2xl font-light uppercase tracking-[0.18em]">
            Checkout station unavailable
          </h2>
          <p className="text-sm leading-6 text-muted-foreground" role="alert">
            This checkout station could not be checked. No sign-in was
            attempted.
          </p>
        </div>
        <button
          type="button"
          className="w-fit text-sm underline"
          onClick={() => setPreflightAttempt((attempt) => attempt + 1)}
        >
          Try again
        </button>
      </section>
    );
  }

  const terminalEvidence = terminal;

  const isBusy = [
    "prepared",
    "auth_issued",
    "activating",
    "promoting",
    "aborting",
  ].includes(phase);
  const canSubmit = code.trim().length > 0 && !isBusy && phase !== "completed";

  async function submit() {
    if (!canSubmit) return;
    try {
      if (phase === "retry_activation" && sessionRef.current) {
        await activatePosRecoveryFlow({
          adapter,
          coordinator: authRuntime,
          onPhase: updatePhase,
          session: sessionRef.current,
        });
        return;
      }
      if (phase === "retry_verification" && sessionRef.current) {
        await verifyPromotedPosRecoveryFlow({
          adapter,
          coordinator: authRuntime,
          onPhase: updatePhase,
          session: sessionRef.current,
        });
        return;
      }
      if (phase === "retry_issue" && sessionRef.current) {
        await issuePosRecoveryFlow({
          adapter,
          code: code.trim(),
          coordinator: authRuntime,
          onPhase: updatePhase,
          session: sessionRef.current,
        });
        return;
      }
      await startPosRecoveryFlow({
        adapter,
        code: code.trim(),
        coordinator: authRuntime,
        onPhase: updatePhase,
        onSession: (session) => {
          sessionRef.current = session;
        },
        redirectTo: redirectTo ?? "/",
        terminalId: terminalEvidence.terminalId,
        terminalProof: terminalEvidence.terminalProof,
      });
    } catch {
      const runtimePhase = authRuntime.getSnapshot().handoffPhase;
      setPhase(
        runtimePhase === "promoted"
          ? "retry_verification"
          : runtimePhase === "auth_issued"
            ? "retry_activation"
            : "retry_issue",
      );
      setErrorMessage(RECOVERY_FAILURE_COPY);
    }
  }

  async function handleBack() {
    if (isBusy) return;
    if (sessionRef.current) {
      setPhase("aborting");
      try {
        await abortPosRecoveryFlow({
          adapter,
          coordinator: authRuntime,
          session: sessionRef.current,
        });
      } catch {
        setPhase("retry_issue");
        setErrorMessage("This sign-in attempt could not be closed. Try again.");
        return;
      }
    }
    onBack();
  }

  return (
    <div className="flex w-full flex-col gap-layout-lg">
      <div className="space-y-layout-md">
        <h2 className="font-display text-2xl font-light uppercase tracking-[0.18em]">
          POS recovery
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-layout-md gap-y-layout-xs text-sm">
          <dt className="text-muted-foreground">Store</dt>
          <dd>{terminalEvidence.storeName}</dd>
          <dt className="text-muted-foreground">Checkout station</dt>
          <dd>{terminalEvidence.displayName}</dd>
        </dl>
        <button
          type="button"
          disabled={isBusy}
          className="group inline-flex items-center gap-layout-xs text-sm text-muted-foreground underline-offset-4 hover:text-foreground"
          onClick={() => void handleBack()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>

      <form
        className="flex w-full flex-col items-start gap-layout-md"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex w-full flex-col gap-layout-sm">
          <label className="text-sm font-medium" htmlFor="pos-recovery-code">
            Recovery code
          </label>
          <Input
            id="pos-recovery-code"
            autoComplete="off"
            autoCapitalize="none"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>

        <div className="min-h-6" aria-live="polite" role="status">
          {errorMessage ?? statusCopy(phase)}
        </div>

        {phase === "completed" ? (
          <p className="text-sm">Checkout station signed in. Opening POS…</p>
        ) : (
          <LoadingButton
            isLoading={isBusy}
            disabled={!canSubmit}
            type="submit"
            variant="workflow"
          >
            {phase === "retry_activation" ||
            phase === "retry_verification" ||
            phase === "retry_issue"
              ? "Try again"
              : "Continue"}
            <ArrowRight className="h-4 w-4" />
          </LoadingButton>
        )}
      </form>
    </div>
  );
}

function statusCopy(phase: string) {
  if (phase === "prepared") return "Preparing secure sign-in…";
  if (phase === "auth_issued") return "Auth session ready…";
  if (phase === "activating") return "Activating this checkout station…";
  if (phase === "promoting") return "Finishing sign-in…";
  return "";
}
