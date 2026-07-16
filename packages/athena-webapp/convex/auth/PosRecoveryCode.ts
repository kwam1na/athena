import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../shared/auth";

const prepareRecoveryForAuthProviderRef = (internal as any).pos.public
  .posRecoveryCodes.prepareRecoveryForAuthProvider;

type PosRecoveryAuthorizeResult = {
  userId: Id<"users">;
  sessionId: Id<"authSessions">;
} | null;

export const PosRecoveryCode: ReturnType<typeof ConvexCredentials> =
  ConvexCredentials({
  id: ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
  authorize: async (credentials, ctx): Promise<PosRecoveryAuthorizeResult> => {
    const code = typeof credentials.code === "string" ? credentials.code : "";
    const recoveryCorrelationKey =
      typeof credentials.recoveryCorrelationKey === "string"
        ? credentials.recoveryCorrelationKey
        : "";
    const terminalId =
      typeof credentials.terminalId === "string" ? credentials.terminalId : "";
    const terminalProof =
      typeof credentials.terminalProof === "string"
        ? credentials.terminalProof
        : "";

    if (!code || !recoveryCorrelationKey || !terminalId || !terminalProof) {
      return null;
    }

    try {
      // Recovery must originate from the isolated, empty Auth namespace. A
      // mounted predecessor session is never allowed to prepare authority.
      if (await ctx.auth.getUserIdentity()) return null;

      const result = (await ctx.runMutation(
        prepareRecoveryForAuthProviderRef,
        {
          code,
          recoveryCorrelationKey,
          terminalId: terminalId as never,
          terminalProof,
        },
      )) as {
        authSessionId: Id<"authSessions">;
        authUserId: Id<"users">;
      };

      return {
        userId: result.authUserId,
        sessionId: result.authSessionId,
      };
    } catch {
      return null;
    }
  },
});
