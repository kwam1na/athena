import {
  ConvexAuthProvider,
  useAuthActions,
  type TokenStorage,
} from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "~/convex/_generated/api";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../../../shared/auth";
import type { AuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import { PosRecoveryCodeForm } from "./PosRecoveryCodeForm";
import type {
  PosRecoveryActivationResult,
  PosRecoveryFrontendAdapter,
} from "./posRecoveryFlow";
import type { PosRecoveryTerminalEvidence } from "./PosRecoveryCodeForm";
import { assertActivatedPosRecoverySession } from "../../../lib/auth/recoverPromotedPosRecoverySession";

type PendingSession = {
  storage: TokenStorage;
  storageNamespace: string;
};

type PendingCommand =
  | {
      id: number;
      kind: "issue";
      input: Parameters<PosRecoveryFrontendAdapter["issue"]>[0];
      reject: (error: unknown) => void;
      resolve: () => void;
    }
  | {
      id: number;
      kind: "activate";
      reject: (error: unknown) => void;
      resolve: (activation: PosRecoveryActivationResult) => void;
    }
  | {
      id: number;
      kind: "abort";
      input: Parameters<PosRecoveryFrontendAdapter["abort"]>[0];
      reject: (error: unknown) => void;
      resolve: () => void;
    };

export function ProductionPosRecoveryCodeForm({
  authRuntime,
  onBack,
  onUseAdministratorEmail,
  redirectTo,
  terminal,
}: {
  authRuntime?: AuthRuntimeHandoffCoordinator;
  onBack: () => void;
  onUseAdministratorEmail: () => void;
  redirectTo?: string | null;
  terminal: PosRecoveryTerminalEvidence | null;
}) {
  const runtime = useProductionPosRecoveryAdapter();

  return (
    <>
      {runtime.pendingSession ? (
        <PendingPosRecoverySession
          key={runtime.pendingSession.storageNamespace}
          command={runtime.command}
          session={runtime.pendingSession}
          settle={runtime.settle}
        />
      ) : null}
      <PosRecoveryCodeForm
        adapter={runtime.adapter}
        authRuntime={authRuntime}
        onBack={onBack}
        onUseAdministratorEmail={onUseAdministratorEmail}
        redirectTo={redirectTo}
        terminal={terminal}
      />
    </>
  );
}

function useProductionPosRecoveryAdapter() {
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(
    null,
  );
  const [command, setCommand] = useState<PendingCommand | null>(null);
  const sequenceRef = useRef(0);
  const requestDisposition = useMutation(
    api.pos.public.posRecoveryCodes.requestPosTerminalRecoveryDisposition,
  );

  const adapter = useMemo<PosRecoveryFrontendAdapter>(
    () => ({
      requestDisposition: async (input) =>
        requestDisposition({
          browserFingerprintHash: input.browserFingerprintHash,
          terminalId: input.terminalId as never,
          terminalProof: input.terminalProof,
        }),
      issue: (input) =>
        new Promise<void>((resolve, reject) => {
          setPendingSession({
            storage: input.storage,
            storageNamespace: input.storageNamespace,
          });
          setCommand({
            id: ++sequenceRef.current,
            input,
            kind: "issue",
            reject,
            resolve,
          });
        }),
      resume: async (input) => {
        setPendingSession({
          storage: input.storage,
          storageNamespace: input.storageNamespace,
        });
      },
      activate: () =>
        new Promise<PosRecoveryActivationResult>((resolve, reject) => {
          setCommand({
            id: ++sequenceRef.current,
            kind: "activate",
            reject,
            resolve,
          });
        }),
      assertActivatedSession: assertActivatedPosRecoverySession,
      abort: (input) =>
        new Promise<void>((resolve, reject) => {
          setCommand({
            id: ++sequenceRef.current,
            input,
            kind: "abort",
            reject,
            resolve,
          });
        }),
    }),
    [requestDisposition],
  );

  return {
    adapter,
    command,
    pendingSession,
    settle: (id: number) =>
      setCommand((current) => (current?.id === id ? null : current)),
  };
}

function PendingPosRecoverySession({
  command,
  session,
  settle,
}: {
  command: PendingCommand | null;
  session: PendingSession;
  settle: (id: number) => void;
}) {
  const client = useMemo(
    () => new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string),
    [],
  );

  useEffect(() => () => void client.close(), [client]);

  return (
    <ConvexAuthProvider
      client={client}
      storage={session.storage}
      storageNamespace={session.storageNamespace}
    >
      <PendingCommandRunner command={command} settle={settle} />
    </ConvexAuthProvider>
  );
}

function PendingCommandRunner({
  command,
  settle,
}: {
  command: PendingCommand | null;
  settle: (id: number) => void;
}) {
  const { signIn } = useAuthActions();
  const { isLoading } = useConvexAuth();
  const activate = useMutation(
    api.pos.public.terminalAppSessions.activatePreparedPosTerminalSession,
  );
  const abort = useMutation(
    api.pos.public.terminalAppSessions.abortPreparedPosTerminalSession,
  );
  const lastCommandIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!command || lastCommandIdRef.current === command.id) return;
    if (command.kind !== "issue" && isLoading) return;
    lastCommandIdRef.current = command.id;

    void (async () => {
      try {
        if (command.kind === "issue") {
          const result = await signIn(ATHENA_POS_RECOVERY_CODE_PROVIDER_ID, {
            code: command.input.code,
            recoveryCorrelationKey: command.input.recoveryCorrelationKey,
            terminalId: command.input.terminalId,
            terminalProof: command.input.terminalProof,
          });
          if (!result.signingIn) throw new Error("pos_recovery_auth_failed");
          command.resolve();
        } else if (command.kind === "activate") {
          const result = await activate({});
          if (result.status === "code_required") {
            command.resolve(result);
            return;
          }
          command.resolve({
            authorityExpiresAt: result.authorityExpiresAt,
            offlineAuthorityReceipt: result.offlineAuthorityReceipt,
            posApplicationSessionBindingId:
              result.posApplicationSessionBindingId,
            servicePrincipalSessionId: result.servicePrincipalSessionId,
            storeId: result.storeId,
            terminalId: result.terminalId,
          });
        } else {
          await abort({
            recoveryCorrelationKey: command.input.recoveryCorrelationKey,
            terminalId: command.input.terminalId as never,
            terminalProof: command.input.terminalProof,
          });
          command.resolve();
        }
      } catch (error) {
        command.reject(error);
      } finally {
        settle(command.id);
      }
    })();
  }, [abort, activate, command, isLoading, settle, signIn]);

  return null;
}
