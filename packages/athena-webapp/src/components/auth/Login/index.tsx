import { useEffect, useMemo, useState } from "react";
import { LoginForm } from "./LoginForm";
import { InputOTPForm } from "./InputOTP";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";
import { ProductionPosRecoveryCodeForm } from "./PosRecoveryFrontendAdapter";
import { useSearch } from "@tanstack/react-router";
import type { PosProvisionedTerminalSeed } from "@/lib/pos/application/posLocalStoreTypes";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { isPosOnlyTerminalLoginMode } from "~/shared/posTerminalLoginMode";
import type { AuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import type { PosRecoveryFrontendAdapter } from "./posRecoveryFlow";
import { getPosTerminalReconnectSettingsRedirect } from "@/lib/pos/application/posTerminalReconnectIntent";
import { generateBrowserFingerprint } from "@/lib/browserFingerprint";

function getPosRedirectFromSeed(seed: PosProvisionedTerminalSeed | null) {
  if (!seed?.orgUrlSlug || !seed.storeUrlSlug) return null;

  return `/${seed.orgUrlSlug}/store/${seed.storeUrlSlug}/pos`;
}

export function Login({
  authRuntime,
  recoveryAdapter,
}: {
  authRuntime?: AuthRuntimeHandoffCoordinator;
  recoveryAdapter?: PosRecoveryFrontendAdapter;
} = {}) {
  const [step, setStep] = useState<
    "signIn" | "posRecovery" | { email: string }
  >("signIn");
  const [localTerminalSeed, setLocalTerminalSeed] =
    useState<PosProvisionedTerminalSeed | null>(null);
  const [browserFingerprintHash, setBrowserFingerprintHash] = useState<
    string | null
  >(null);
  const [isTerminalEvidenceLoading, setIsTerminalEvidenceLoading] =
    useState(true);
  const search = useSearch({ strict: false }) as
    { redirectTo?: string } | undefined;
  const localPosRedirect = useMemo(
    () => getPosRedirectFromSeed(localTerminalSeed),
    [localTerminalSeed],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result =
        await getDefaultPosLocalStore().readProvisionedTerminalSeed();

      if (!cancelled && result.ok) {
        const seed = result.value;
        setLocalTerminalSeed(seed);
        if (seed) {
          try {
            const fingerprint = await generateBrowserFingerprint();
            if (!cancelled) {
              setBrowserFingerprintHash(fingerprint.fingerprintHash);
            }
          } catch {
            if (!cancelled) setBrowserFingerprintHash(null);
          }
        }
        if (isPosOnlyTerminalLoginMode(seed?.loginMode)) {
          setStep((current) =>
            current === "signIn" ? "posRecovery" : current,
          );
        }
      }
      if (!cancelled) setIsTerminalEvidenceLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isTerminalEvidenceLoading) {
    return <p role="status">Checking this checkout station…</p>;
  }

  if (step === "signIn") {
    return (
      <LoginForm
        setStep={setStep}
        onUsePosRecoveryCode={() => setStep("posRecovery")}
        terminalName={localTerminalSeed?.displayName}
      />
    );
  }
  if (step === "posRecovery") {
    const props = {
      authRuntime,
      terminal: localTerminalSeed
        ? {
          displayName: localTerminalSeed.displayName,
          storeName: localTerminalSeed.storeUrlSlug ?? "This store",
          browserFingerprintHash: browserFingerprintHash ?? "",
          terminalId: localTerminalSeed.cloudTerminalId,
            terminalProof: localTerminalSeed.syncSecretHash,
          }
        : null,
      redirectTo: search?.redirectTo ?? localPosRedirect,
      onBack: () => setStep("signIn"),
      onUseAdministratorEmail: () => setStep("signIn"),
    };
    return recoveryAdapter ? (
      <PosRecoveryCodeForm adapter={recoveryAdapter} {...props} />
    ) : (
      <ProductionPosRecoveryCodeForm {...props} />
    );
  }
  return (
    <InputOTPForm
      email={step.email}
      onBack={() => setStep("signIn")}
      redirectTo={getPosTerminalReconnectSettingsRedirect(localTerminalSeed)}
    />
  );
}
