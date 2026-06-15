import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";

import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
  type StaffAuthMode,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import { runCommand } from "@/lib/errors/runCommand";
import { logger } from "@/lib/logger";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalStaffAuthorityRecord,
} from "@/lib/pos/infrastructure/local/posLocalStore";
import { refreshAndStoreTerminalStaffAuthority } from "@/lib/pos/infrastructure/local/terminalStaffAuthorityRefresh";
import {
  unwrapLocalStaffProofToken,
  verifyLocalPin,
  wrapLocalStaffProofToken,
} from "@/lib/security/localPinVerifier";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError, type CommandResult } from "~/shared/commandResult";
import type { RegisterWorkflowMode } from "~/src/lib/pos/presentation/register/registerUiState";

interface CashierAuthDialogProps {
  onAuthenticated: (result: StaffAuthenticationResult) => void;
  onDismiss: () => void;
  open: boolean;
  presentation?: "dialog" | "inline";
  restoredCashier?: {
    displayName?: string | null;
    username: string;
  } | null;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  workflowMode?: RegisterWorkflowMode;
}

type StaffAuthenticationResultWithLocalAuthority = StaffAuthenticationResult & {
  localStaffAuthority?: PosLocalStaffAuthorityRecord;
  posLocalStaffAuthority?: PosLocalStaffAuthorityRecord;
};

function getStaffDisplayName(result: StaffAuthenticationResult) {
  return (
    result.staffProfile.fullName ||
    [result.staffProfile.firstName, result.staffProfile.lastName]
      .filter(Boolean)
      .join(" ")
  );
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function CashierAuthDialog({
  onAuthenticated,
  onDismiss,
  open,
  presentation = "dialog",
  restoredCashier,
  storeId,
  terminalId,
  workflowMode = "pos",
}: CashierAuthDialogProps) {
  const authenticateStaffCredentialForTerminal = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForTerminal,
  );
  const refreshTerminalStaffAuthority = useMutation(
    api.operations.staffCredentials.refreshTerminalStaffAuthority,
  );
  const expireAllSessionsForStaff = useMutation(
    api.inventory.posSessions.expireAllSessionsForStaff,
  );
  const localStore = useMemo(
    () =>
      createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter(),
      }),
    [],
  );
  const isExpenseWorkflow = workflowMode === "expense";

  const persistAuthenticatedStaffAuthority = useCallback(
    async (result: StaffAuthenticationResult, pin: string) => {
      const localAuthority = (
        result as StaffAuthenticationResultWithLocalAuthority
      ).localStaffAuthority ?? (
        result as StaffAuthenticationResultWithLocalAuthority
      ).posLocalStaffAuthority;
      const proof = result.posLocalStaffProof;
      if (
        !localAuthority ||
        !proof ||
        localAuthority.storeId !== storeId ||
        localAuthority.terminalId !== terminalId
      ) {
        return;
      }

      const wrappedProof = await wrapLocalStaffProofToken(
        localAuthority.verifier,
        pin,
        proof,
      );
      if (!wrappedProof) {
        logger.warn("[POS] Authenticated staff proof could not be wrapped", {
          staffProfileId: localAuthority.staffProfileId,
          storeId,
          terminalId,
        });
        return;
      }

      const writeResult = await localStore.upsertStaffAuthorityRecord({
        record: {
          ...localAuthority,
          wrappedPosLocalStaffProof: wrappedProof,
        },
        storeId,
        terminalId,
      });
      if (!writeResult.ok) {
        logger.warn("[POS] Authenticated staff authority could not be stored", {
          code: writeResult.error.code,
          staffProfileId: localAuthority.staffProfileId,
          storeId,
          terminalId,
        });
      }
    },
    [localStore, storeId, terminalId],
  );

  const refreshLocalAuthority = useCallback(async (unlock?: {
    pin: string;
    posLocalStaffProof?: { expiresAt: number; token: string };
    staffProfileId: Id<"staffProfile">;
  }): Promise<PosLocalStaffAuthorityRecord | null> => {
    if (isBrowserOffline()) {
      return null;
    }

    const refreshOutcome = await refreshAndStoreTerminalStaffAuthority({
      localStore,
      refreshTerminalStaffAuthority: refreshTerminalStaffAuthority as Parameters<
        typeof refreshAndStoreTerminalStaffAuthority
      >[0]["refreshTerminalStaffAuthority"],
      storeId,
      terminalId,
      mapRecords: async (records) =>
        Promise.all(
          records.map(async (record) => {
            if (
              !unlock?.posLocalStaffProof ||
              record.staffProfileId !== unlock.staffProfileId
            ) {
              return record;
            }

            const wrappedProof = await wrapLocalStaffProofToken(
              record.verifier,
              unlock.pin,
              unlock.posLocalStaffProof,
            );
            if (!wrappedProof) {
              logger.warn("[POS] Staff authority proof could not be wrapped", {
                staffProfileId: record.staffProfileId,
                storeId,
                terminalId,
              });
              return record;
            }

            return {
              ...record,
              wrappedPosLocalStaffProof: wrappedProof,
            };
          }),
        ),
    });

    if (refreshOutcome.status === "preserved") {
      logger.warn("[POS] Staff authority refresh skipped", {
        code: refreshOutcome.code,
        message: refreshOutcome.message,
        storeId,
        terminalId,
      });
      return null;
    }

    if (refreshOutcome.status === "write_failed") {
      logger.warn("[POS] Staff authority refresh could not be stored", {
        message: refreshOutcome.message,
        storeId,
        terminalId,
      });
      return null;
    }

    const records = refreshOutcome.records;
    return (
      records.find(
        (record) =>
          unlock?.staffProfileId === record.staffProfileId &&
          Boolean(record.wrappedPosLocalStaffProof),
      ) ?? null
    );
  }, [localStore, refreshTerminalStaffAuthority, storeId, terminalId]);

  useEffect(() => {
    if (!open || isBrowserOffline()) {
      return;
    }

    void refreshLocalAuthority();
  }, [open, refreshLocalAuthority, storeId, terminalId]);

  async function authenticateOfflineStaff(args: {
    pin: string;
    username: string;
  }): Promise<CommandResult<StaffAuthenticationResult>> {
    const authorityResult = await localStore.readStaffAuthorityForUsername({
      storeId,
      terminalId,
      username: args.username,
    });

    if (!authorityResult.ok) {
      logger.warn("[POS] Local staff authority read failed", {
        code: authorityResult.error.code,
        storeId,
        terminalId,
      });
      return userError({
        code: "precondition_failed",
        message: "Offline staff sign-in is unavailable. Reconnect, then try again.",
      });
    }

    const authority = authorityResult.value;
    if (!authority) {
      return userError({
        code: "precondition_failed",
        message:
          "Staff list is not ready on this terminal. Reconnect once to refresh staff credentials.",
      });
    }

    const verification = await verifyLocalPin(authority.verifier, args.pin);
    if (!verification.ok) {
      if (verification.reason === "invalid_pin") {
        return userError({
          code: "authentication_failed",
          message: "Sign-in details not recognized. Enter the username and PIN again.",
        });
      }

      return userError({
        code: "precondition_failed",
        message: "Offline staff sign-in needs a refresh. Reconnect, then try again.",
      });
    }

    const authenticationResult = {
      activeRoles: authority.activeRoles,
      localStaffAuthority: authority,
      staffProfile: {
        fullName: authority.displayName ?? null,
      },
      staffProfileId: authority.staffProfileId as Id<"staffProfile">,
    };

    if (!authority.wrappedPosLocalStaffProof) {
      logger.info("[POS] Offline staff sign-in continuing without staff proof", {
        staffProfileId: authority.staffProfileId,
        storeId,
        terminalId,
      });
      return ok(authenticationResult);
    }

    const posLocalStaffProof = await unwrapLocalStaffProofToken(
      authority.verifier,
      args.pin,
      authority.wrappedPosLocalStaffProof,
    );
    if (!posLocalStaffProof || posLocalStaffProof.expiresAt <= Date.now()) {
      logger.info("[POS] Offline staff sign-in continuing with proof refresh due", {
        staffProfileId: authority.staffProfileId,
        storeId,
        terminalId,
      });
      return ok(authenticationResult);
    }

    return ok({
      ...authenticationResult,
      posLocalStaffProof,
    });
  }

  async function authenticateStaff(args: {
    mode: StaffAuthMode;
    pin: string;
    pinHash: string;
    username: string;
  }) {
    if (isBrowserOffline()) {
      if (args.mode === "recover") {
        return userError({
          code: "precondition_failed",
          message: isExpenseWorkflow
            ? "Other session sign-outs need a connection. Reconnect, then try again."
            : "Other register sign-outs need a connection. Reconnect, then try again.",
        });
      }

      logger.info("[POS] Cashier authentication using local authority", {
        mode: args.mode,
        storeId,
        terminalId,
        workflowMode,
      });

      return authenticateOfflineStaff(args);
    }

    const authenticationResult = await runCommand(() =>
      authenticateStaffCredentialForTerminal({
        allowedRoles: ["cashier", "manager"],
        allowActiveSessionsOnOtherTerminals: args.mode === "recover",
        pinHash: args.pinHash,
        storeId,
        terminalId,
        username: args.username,
      }),
    );

    if (authenticationResult.kind !== "ok") {
      return authenticationResult;
    }

    void persistAuthenticatedStaffAuthority(authenticationResult.data, args.pin);
    const localStaffAuthority = await refreshLocalAuthority({
      pin: args.pin,
      posLocalStaffProof: authenticationResult.data.posLocalStaffProof,
      staffProfileId: authenticationResult.data.staffProfileId,
    });
    const authenticationData = localStaffAuthority
      ? {
          ...authenticationResult.data,
          localStaffAuthority,
        }
      : authenticationResult.data;

    if (args.mode === "authenticate") {
      return ok(authenticationData);
    }

    const expireResult = await expireAllSessionsForStaff({
      staffProfileId: authenticationResult.data.staffProfileId,
      terminalId,
    });

    if (!expireResult.success) {
      return userError({
        code: "precondition_failed",
        message: isExpenseWorkflow
          ? "Other session sign-outs not completed. Try again."
          : "Other register sign-outs not completed. Try again.",
      });
    }

    const recoveryResult = await runCommand(() =>
      authenticateStaffCredentialForTerminal({
        allowedRoles: ["cashier", "manager"],
        pinHash: args.pinHash,
        storeId,
        terminalId,
        username: args.username,
      }),
    );
    if (recoveryResult.kind === "ok") {
      void persistAuthenticatedStaffAuthority(recoveryResult.data, args.pin);
      const recoveryLocalStaffAuthority = await refreshLocalAuthority({
        pin: args.pin,
        posLocalStaffProof: recoveryResult.data.posLocalStaffProof,
        staffProfileId: recoveryResult.data.staffProfileId,
      });
      if (recoveryLocalStaffAuthority) {
        return ok({
          ...recoveryResult.data,
          localStaffAuthority: recoveryLocalStaffAuthority,
        });
      }
    }

    return recoveryResult;
  }

  const primaryCopy = isExpenseWorkflow
    ? {
        title: "Sign in required",
        description: "Authenticate to record expenses",
      }
    : {
        title: "Sign in required",
        description: "Authenticate to add items",
      };
  const recoveryLabel = isExpenseWorkflow
    ? "Sign out from other sessions"
    : "Sign out from other registers";

  return (
    <StaffAuthenticationDialog
      open={open}
      presentation={presentation}
      onDismiss={onDismiss}
      copy={{
        title: primaryCopy.title,
        description: primaryCopy.description,
        submitLabel: "Sign in",
      }}
      lockedUsername={restoredCashier}
      lockedUsernameCopy={{
        title: "Unlock cashier session",
        description: "Enter the cashier PIN to continue on this register",
        submitLabel: "Unlock",
      }}
      alternateCopy={{
        title: recoveryLabel,
        description: isExpenseWorkflow
          ? "Confirm your staff credentials to end other active expense sessions"
          : "Confirm your staff credentials to end other active register sessions",
        submitLabel: isExpenseWorkflow
          ? "Sign out from other sessions"
          : "Sign out from all registers",
      }}
      alternateTriggerLabel={recoveryLabel}
      returnTriggerLabel="Return to sign in"
      onAuthenticate={authenticateStaff}
      getSuccessMessage={(result, mode) => {
        if (mode === "recover") {
          return isExpenseWorkflow
            ? "Signed out from other sessions"
            : "Signed out from all registers";
        }

        const staffDisplayName = getStaffDisplayName(result);
        return staffDisplayName
          ? `Signed in as ${staffDisplayName}`
          : "Signed in";
      }}
      onAuthenticated={(result) => {
        onAuthenticated(result);
      }}
    />
  );
}
