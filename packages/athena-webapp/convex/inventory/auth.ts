import { v } from "convex/values";
import { action, internalMutation, mutation } from "../_generated/server";
import { sendVerificationCode } from "../mailersend";
import { internal } from "../_generated/api";
import {
  findAthenaUserByEmailWithCtx,
  normalizeAthenaUserEmail,
  syncAuthenticatedAthenaUserWithCtx,
} from "../lib/athenaUserAuth";
import { ok, userError } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  admitPublicAction,
  admitPublicMutation,
} from "../platform/operationAdmission";
import {
  sendVerificationCodeViaProviderOperationDefinition,
  syncAuthenticatedAthenaUserOperationDefinition,
  verifyCodeOperationDefinition,
} from "../operationAdmission/domains/u4_inventoryIdentity_definitions";
import type { OperationMutationCtx } from "../operationAdmission/types";

const expirationTimeInMinutes = 10;

export const requestVerificationCode = internalMutation({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // set an expiration time 10 minutes from now
    const expiration =
      new Date().getTime() + expirationTimeInMinutes * 60 * 1000;

    const id = await ctx.db.insert("appVerificationCode", {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      code: verificationCode,
      expiration,
      isUsed: false,
    });

    return await ctx.db.get("appVerificationCode", id);
  },
});

export const verifyCode = mutation({
  args: {
    code: v.string(),
    email: v.string(),
  },
  returns: commandResultValidator(v.any()),
  // Pre-auth: `public: "admit"` on the definition, because the caller is
  // proving an emailed code and has no Athena identity yet.
  handler: admitPublicMutation(
    verifyCodeOperationDefinition,
    async (ctx: OperationMutationCtx, args: { code: string; email: string }) => {
    const verificationCode = await ctx.db
      .query("appVerificationCode")
      .filter((q) =>
        q.and(
          q.eq(q.field("code"), args.code),
          q.eq(q.field("email"), args.email)
        )
      )
      .first();

    if (!verificationCode) {
      return userError({
        code: "authentication_failed",
        message: "Invalid verification code.",
      });
    }

    // check that the verification code has not expired
    if (new Date().getTime() > verificationCode.expiration) {
      return userError({
        code: "authentication_failed",
        message: "This verification code has expired.",
      });
    }

    if (verificationCode.isUsed) {
      return userError({
        code: "authentication_failed",
        message: "This verification code has already been used.",
      });
    }

    await ctx.db.patch("appVerificationCode", verificationCode._id, {
      isUsed: true,
    });

    const user = await findAthenaUserByEmailWithCtx(
      ctx,
      verificationCode.email,
    );

    if (!user) {
      const normalizedEmail = normalizeAthenaUserEmail(verificationCode.email);
      const id = await ctx.db.insert("athenaUser", {
        email: verificationCode.email,
        normalizedEmail,
        firstName: verificationCode.firstName,
        lastName: verificationCode.lastName,
      });

      const createdUser = await ctx.db.get("athenaUser", id);
      if (!createdUser) {
        return userError({
          code: "unavailable",
          message: "Could not retrieve user.",
        });
      }
      return ok(createdUser);
    }

    return ok(user);
    },
  ),
});

function mapAthenaAuthSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message === "Sign in again to continue.") {
    return userError({
      code: "authentication_failed",
      message,
      retryable: true,
    });
  }

  if (message.includes("Multiple Athena users match this email")) {
    return userError({
      code: "conflict",
      message,
    });
  }

  return null;
}

export const syncAuthenticatedAthenaUser = mutation({
  args: {},
  returns: commandResultValidator(v.any()),
  // Pre-auth: this mutation MATERIALIZES the Athena user row from the auth
  // session, so it runs before a normal-user identity exists. The handler
  // still resolves the auth session itself and maps "no session" to a typed
  // `authentication_failed` result exactly as before.
  handler: admitPublicMutation(
    syncAuthenticatedAthenaUserOperationDefinition,
    async (ctx: OperationMutationCtx) => {
      try {
        const user = await syncAuthenticatedAthenaUserWithCtx(ctx);
        return ok(user);
      } catch (error) {
        const mappedError = mapAthenaAuthSyncError(error);
        if (mappedError) {
          return mappedError;
        }

        throw error;
      }
    },
  ),
});

export const sendVerificationCodeViaProvider = action({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  // `denySharedDemoEffectIfApplicable` retired: the definition declares
  // `sharedDemo: "deny"`, so a demo visitor is denied at admission rather than
  // by a runQuery inside the body.
  handler: admitPublicAction(
    sendVerificationCodeViaProviderOperationDefinition,
    async (
      ctx,
      args: { email: string; firstName?: string; lastName?: string },
    ) => {
    const data: any = await ctx.runMutation(
      internal.inventory.auth.requestVerificationCode,
      {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
      }
    );

    if (!data) {
      return {
        success: false,
        message: "Could not send verification code",
      };
    }

    const response = await sendVerificationCode({
      customerEmail: args.email,
      verificationCode: data.code,
      storeName: "Wigclub",
      validTime: `${expirationTimeInMinutes} minutes`,
    });

    if (response.ok) {
      return {
        success: true,
        message: "Verification code sent",
        data: {
          email: args.email,
        },
      };
    } else {
      console.error("Failed to send verification code", response);
      return {
        success: false,
        message: "Could not send verification code",
      };
    }
    },
  ),
});
