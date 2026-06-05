import { useEffect, useMemo, useState } from "react";
import { LoginForm } from "./LoginForm";
import { InputOTPForm } from "./InputOTP";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";
import { useSearch } from "@tanstack/react-router";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosProvisionedTerminalSeed,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { isPosOnlyTerminalLoginMode } from "~/shared/posTerminalLoginMode";

const POS_ROUTE_PATTERN =
  /^\/(?<orgUrlSlug>[^/]+)\/store\/(?<storeUrlSlug>[^/]+)\/pos(?:\/.*)?$/;

function getPosRouteScope(redirectTo?: string) {
  const match = redirectTo?.match(POS_ROUTE_PATTERN);
  const groups = match?.groups;
  if (!groups?.orgUrlSlug || !groups.storeUrlSlug) {
    return null;
  }

  return {
    orgUrlSlug: groups.orgUrlSlug,
    storeUrlSlug: groups.storeUrlSlug,
  };
}

function getPosRedirectFromSeed(seed: PosProvisionedTerminalSeed | null) {
  if (!seed?.orgUrlSlug || !seed.storeUrlSlug) return null;

  return `/${seed.orgUrlSlug}/store/${seed.storeUrlSlug}/pos`;
}

export function Login() {
  const [step, setStep] = useState<"signIn" | "posRecovery" | { email: string }>(
    "signIn",
  );
  const [localTerminalSeed, setLocalTerminalSeed] =
    useState<PosProvisionedTerminalSeed | null>(null);
  const search = useSearch({ strict: false }) as
    | { redirectTo?: string; storeId?: string }
    | undefined;
  const posRouteScope = getPosRouteScope(search?.redirectTo);
  const localPosRedirect = useMemo(
    () => getPosRedirectFromSeed(localTerminalSeed),
    [localTerminalSeed],
  );

  useEffect(() => {
    let cancelled = false;

    if (typeof indexedDB === "undefined") {
      return;
    }

    void (async () => {
      const result = await createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }).readProvisionedTerminalSeed();

      if (!cancelled && result.ok) {
        setLocalTerminalSeed(result.value);
        if (isPosOnlyTerminalLoginMode(result.value?.loginMode)) {
          setStep((current) =>
            current === "signIn" ? "posRecovery" : current,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (step === "signIn") {
    return (
      <LoginForm
        setStep={setStep}
        onUsePosRecoveryCode={() => setStep("posRecovery")}
      />
    );
  }
  if (step === "posRecovery") {
    return (
      <PosRecoveryCodeForm
        orgUrlSlug={
          posRouteScope?.orgUrlSlug ?? localTerminalSeed?.orgUrlSlug ?? null
        }
        redirectTo={search?.redirectTo ?? localPosRedirect}
        storeId={search?.storeId ?? localTerminalSeed?.storeId ?? null}
        storeUrlSlug={
          posRouteScope?.storeUrlSlug ?? localTerminalSeed?.storeUrlSlug ?? null
        }
        onBack={() => setStep("signIn")}
      />
    );
  }
  return (
    <InputOTPForm email={step.email} onBack={() => setStep("signIn")} />
  );
}
