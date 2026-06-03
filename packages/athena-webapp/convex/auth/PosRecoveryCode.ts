import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ATHENA_POS_RECOVERY_CODE_PROVIDER_ID } from "../../shared/auth";

const verifyRecoveryCodeForAuthProviderRef = (internal as any).pos.public
  .posRecoveryCodes.verifyRecoveryCodeForAuthProvider;

type PosRecoveryAuthorizeResult = { userId: Id<"users"> } | null;

export const PosRecoveryCode: ReturnType<typeof ConvexCredentials> =
  ConvexCredentials({
  id: ATHENA_POS_RECOVERY_CODE_PROVIDER_ID,
  authorize: async (credentials, ctx): Promise<PosRecoveryAuthorizeResult> => {
    const email = typeof credentials.email === "string" ? credentials.email : "";
    const code = typeof credentials.code === "string" ? credentials.code : "";
    const orgUrlSlug =
      typeof credentials.orgUrlSlug === "string" ? credentials.orgUrlSlug : undefined;
    const storeId =
      typeof credentials.storeId === "string" ? credentials.storeId : undefined;
    const storeUrlSlug =
      typeof credentials.storeUrlSlug === "string"
        ? credentials.storeUrlSlug
        : undefined;

    if (!email || !code || (!storeId && (!orgUrlSlug || !storeUrlSlug))) {
      return null;
    }

    try {
      const result = (await ctx.runMutation(
        verifyRecoveryCodeForAuthProviderRef,
        {
          code,
          email,
          orgUrlSlug,
          storeId: storeId as never,
          storeUrlSlug,
        },
      )) as { authUserId: Id<"users"> };

      return { userId: result.authUserId };
    } catch {
      return null;
    }
  },
});
