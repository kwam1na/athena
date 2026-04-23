import { v } from "convex/values";
import { action, internalMutation, mutation } from "../_generated/server";
import { sendVerificationCode } from "../mailersend";
import { internal } from "../_generated/api";
import { syncAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { ok, userError } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";

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
  handler: async (ctx, args) => {
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

    let user = await ctx.db
      .query("athenaUser")
      .filter((q) =>
        q.eq(q.field("email"), verificationCode.email.toLowerCase())
      )
      .first();

    if (!user) {
      const id = await ctx.db.insert("athenaUser", {
        email: verificationCode.email,
        firstName: verificationCode.firstName,
        lastName: verificationCode.lastName,
      });

      user = await ctx.db.get("athenaUser", id);
    }

    if (!user) {
      return userError({
        code: "unavailable",
        message: "Could not retrieve user.",
      });
    }

    return ok(user);
  },
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
  handler: async (ctx) => {
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
});

export const sendVerificationCodeViaProvider = action({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
});
