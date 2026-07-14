import { useParams } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { SharedDemoStatusBar } from "./SharedDemoStatusBar";
import { getSharedDemoRoutes } from "./sharedDemoRoutes";
import { api } from "~/convex/_generated/api";
import { generateBrowserFingerprint } from "@/lib/browserFingerprint";
import { FINGERPRINT_STORAGE_KEY } from "@/lib/constants";
import { readStoredTerminalFingerprint } from "@/lib/pos/infrastructure/terminal/fingerprint";
import { registerAndProvisionPosTerminal } from "@/lib/pos/application/registerAndProvisionPosTerminal";
import {
  getDefaultPosLocalStore,
  requestDefaultPosLocalPersistentStorage,
} from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import type { Id } from "~/convex/_generated/dataModel";
import { useSharedDemoContext } from "@/hooks/useSharedDemoContext";
import {
  getSharedDemoRegisterNumber,
  getSharedDemoRestoreEpochStorageKey,
  getSharedDemoTerminalName,
  planSharedDemoLocalBootstrap,
  resolveSharedDemoRegisterBootstrapAction,
} from "./sharedDemoLocalBootstrap";
import { seedRegisterSessionAuthorityBootstrap } from "@/lib/pos/infrastructure/local/registerSessionAuthorityBootstrap";
import type { RegisterSessionAuthorityBootstrap } from "@/lib/pos/infrastructure/local/registerSessionAuthorityBootstrap";
import { readProjectedLocalRegisterModel } from "@/lib/pos/infrastructure/local/localRegisterReader";
import { coordinateSharedDemoRuntime } from "./sharedDemoRuntimeCoordinator";

export type SharedDemoRegisterBootstrapStatus =
  "idle" | "provisioning" | "projecting" | "ready" | "failed";

const SharedDemoRegisterBootstrapContext =
  createContext<SharedDemoRegisterBootstrapStatus>("ready");

export function useSharedDemoRegisterBootstrapStatus() {
  return useContext(SharedDemoRegisterBootstrapContext);
}

async function projectSharedDemoRegisterBootstrap(input: {
  bootstrap: RegisterSessionAuthorityBootstrap;
  storeId: string;
  terminalId: string;
}) {
  const store = getDefaultPosLocalStore();
  const seedResult = await seedRegisterSessionAuthorityBootstrap({
    bootstrap: input.bootstrap,
    store,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
  if (!seedResult.seeded) {
    throw new Error(
      `The demo register session could not be projected (${seedResult.seedResult}).`,
    );
  }
  const projection = await readProjectedLocalRegisterModel({
    isOnline: false,
    store,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
  if (
    !projection.ok ||
    projection.value.activeRegisterSession?.localRegisterSessionId !==
      input.bootstrap.localRegisterSessionId ||
    (projection.value.activeRegisterSession.status !== "active" &&
      projection.value.activeRegisterSession.status !== "open")
  ) {
    throw new Error("The demo register session was not available locally.");
  }
}

export function SharedDemoRuntime({
  children,
  gatePosUntilReady = false,
  showControls = true,
}: {
  children?: ReactNode;
  gatePosUntilReady?: boolean;
  showControls?: boolean;
}) {
  const context = useSharedDemoContext();
  const registerTerminal = useMutation(
    api.inventory.posTerminal.registerTerminal,
  );
  const bindRegisterBaseline = useMutation(
    api.sharedDemo.public.bindRegisterBaselineToTerminal,
  );
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const contextRestoreEpoch = context?.restore.epoch;
  const storeId = context?.storeId;
  const restoreEpoch = contextRestoreEpoch;
  const [bootstrapStatus, setBootstrapStatus] =
    useState<SharedDemoRegisterBootstrapStatus>("idle");
  useEffect(() => {
    if (
      !storeId ||
      restoreEpoch === undefined ||
      !orgUrlSlug ||
      !storeUrlSlug
    ) {
      return;
    }
    let cancelled = false;
    setBootstrapStatus("provisioning");

    void coordinateSharedDemoRuntime(storeId, restoreEpoch, async () => {
      const localStore = getDefaultPosLocalStore();
      const epochStorageKey = getSharedDemoRestoreEpochStorageKey(storeId);
      const priorEpochValue = window.localStorage.getItem(epochStorageKey);
      const storedSeed = await localStore.readProvisionedTerminalSeed();
      const storedTerminalSeed = storedSeed.ok ? storedSeed.value : null;
      const hasTerminalSeed = Boolean(storedTerminalSeed);
      const hasMatchingTerminalSeed = storedTerminalSeed?.storeId === storeId;
      const expectedRegisterNumber = storedTerminalSeed
        ? getSharedDemoRegisterNumber(storedTerminalSeed.terminalId)
        : null;
      const hasMatchingRegisterNumber =
        expectedRegisterNumber !== null &&
        storedTerminalSeed?.registerNumber === expectedRegisterNumber;
      const plan = planSharedDemoLocalBootstrap({
        currentEpoch: restoreEpoch,
        hasMatchingRegisterNumber,
        hasMatchingTerminalSeed,
        hasTerminalSeed,
        priorEpoch: priorEpochValue === null ? null : Number(priorEpochValue),
      });
      if (plan.resetOperationalState) {
        const reset = await localStore.resetSharedDemoLocalState?.();
        if (reset && !reset.ok) throw new Error(reset.error.message);
      }

      if (plan.provisionTerminal) {
        const fingerprint =
          readStoredTerminalFingerprint() ??
          (await generateBrowserFingerprint());
        window.localStorage.setItem(
          FINGERPRINT_STORAGE_KEY,
          JSON.stringify(fingerprint),
        );
        const registerNumber = getSharedDemoRegisterNumber(
          fingerprint.fingerprintHash,
        );
        const result = await registerAndProvisionPosTerminal({
          activeStoreId: storeId,
          browserInfo: fingerprint.browserInfo,
          displayName: getSharedDemoTerminalName(fingerprint.fingerprintHash),
          fingerprintHash: fingerprint.fingerprintHash,
          heartbeatEnabled: true,
          loginMode: "pos_only",
          orgUrlSlug,
          registerNumber,
          registerTerminalMutation: registerTerminal,
          requestPersistentStorage: requestDefaultPosLocalPersistentStorage,
          storeFactory: getDefaultPosLocalStore,
          storeUrlSlug,
          transactionCapability: "products_only",
        });
        if (result.kind === "user_error") {
          throw new Error(result.error.message);
        }
      }
      let boundBootstrap: RegisterSessionAuthorityBootstrap | null = null;
      const seedBeforeBinding = await localStore.readProvisionedTerminalSeed();
      if (!seedBeforeBinding.ok || !seedBeforeBinding.value) {
        throw new Error(
          "The demo register could not be linked to this browser.",
        );
      }
      const localProjectionBeforeBinding =
        await readProjectedLocalRegisterModel({
          isOnline: false,
          store: localStore,
          storeId,
          terminalId: seedBeforeBinding.value.terminalId,
        });
      const localSessionBeforeBinding = localProjectionBeforeBinding.ok
        ? localProjectionBeforeBinding.value.activeRegisterSession
        : null;
      const hasUsableLocalSession = Boolean(
        localSessionBeforeBinding &&
        (localSessionBeforeBinding.status === "active" ||
          localSessionBeforeBinding.status === "open"),
      );
      const registerBootstrapAction = resolveSharedDemoRegisterBootstrapAction({
        bindRegisterBaseline: plan.bindRegisterBaseline,
        hasUsableLocalSession,
      });
      if (registerBootstrapAction === "bind") {
        const baseline = await bindRegisterBaseline({
          terminalId: seedBeforeBinding.value
            .cloudTerminalId as Id<"posTerminal">,
        });
        boundBootstrap = baseline.bootstrap;
      }
      const currentSeed = await localStore.readProvisionedTerminalSeed();
      if (!currentSeed.ok || !currentSeed.value) {
        throw new Error("The demo register is not available on this browser.");
      }
      if (boundBootstrap) {
        await projectSharedDemoRegisterBootstrap({
          bootstrap: boundBootstrap,
          storeId,
          terminalId: currentSeed.value.terminalId,
        });
      }
      window.localStorage.setItem(epochStorageKey, String(restoreEpoch));
    })
      .then(() => {
        if (!cancelled) setBootstrapStatus("ready");
      })
      .catch((error) => {
        console.error("[shared-demo] POS bootstrap failed", error);
        if (!cancelled) setBootstrapStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [
    bindRegisterBaseline,
    orgUrlSlug,
    registerTerminal,
    restoreEpoch,
    storeId,
    storeUrlSlug,
  ]);
  const providedBootstrapStatus =
    gatePosUntilReady && context ? bootstrapStatus : "ready";
  if (!context || !orgUrlSlug || !storeUrlSlug) {
    return (
      <SharedDemoRegisterBootstrapContext.Provider
        value={providedBootstrapStatus}
      >
        {children}
      </SharedDemoRegisterBootstrapContext.Provider>
    );
  }
  const routes = getSharedDemoRoutes(orgUrlSlug, storeUrlSlug);
  return (
    <SharedDemoRegisterBootstrapContext.Provider
      value={providedBootstrapStatus}
    >
      {showControls ? <SharedDemoStatusBar homeHref={routes.home} /> : null}
      {children}
    </SharedDemoRegisterBootstrapContext.Provider>
  );
}
