import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { InputOTPForm } from "./InputOTP";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";
import { useSearch } from "@tanstack/react-router";

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

export function Login() {
  const [step, setStep] = useState<"signIn" | "posRecovery" | { email: string }>(
    "signIn",
  );
  const search = useSearch({ strict: false }) as
    | { redirectTo?: string; storeId?: string }
    | undefined;
  const posRouteScope = getPosRouteScope(search?.redirectTo);

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
        orgUrlSlug={posRouteScope?.orgUrlSlug ?? null}
        redirectTo={search?.redirectTo ?? null}
        storeId={search?.storeId ?? null}
        storeUrlSlug={posRouteScope?.storeUrlSlug ?? null}
        onBack={() => setStep("signIn")}
      />
    );
  }
  return (
    <InputOTPForm email={step.email} onBack={() => setStep("signIn")} />
  );
}
