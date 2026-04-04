import { v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  MutationCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { sendVerificationCode } from "../mailersend";
import { internal } from "../_generated/api";
import { SignJWT } from "jose";

const expirationTimeInMinutes = 10;

async function getStoreFrontActorById(
  ctx: MutationCtx,
  userId: Id<"storeFrontUser"> | Id<"guest">
) {
  try {
    const storeFrontUser = await ctx.db.get(
      "storeFrontUser",
      userId as Id<"storeFrontUser">
    );
    if (storeFrontUser) {
      return storeFrontUser;
    }
  } catch {}

  try {
    return await ctx.db.get("guest", userId as Id<"guest">);
  } catch {
    return null;
  }
}

export const requestVerificationCode = internalMutation({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // set an expiration time 10 minutes from now
    const expiration =
      new Date().getTime() + expirationTimeInMinutes * 60 * 1000;

    const id = await ctx.db.insert("storeFrontVerificationCode", {
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      code: verificationCode,
      expiration,
      storeId: args.storeId,
      isUsed: false,
    });

    return await ctx.db.get("storeFrontVerificationCode", id);
  },
});

export const verifyCode = mutation({
  args: {
    code: v.string(),
    email: v.string(),
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
  },
  handler: async (ctx, args) => {
    const verificationCode = await ctx.db
      .query("storeFrontVerificationCode")
      .filter((q) =>
        q.and(
          q.eq(q.field("code"), args.code),
          q.eq(q.field("email"), args.email)
        )
      )
      .first();

    if (!verificationCode) {
      return {
        error: true,
        message: "Invalid verification code",
      };
    }

    // check that the verification code has not expired
    if (new Date().getTime() > verificationCode.expiration) {
      return {
        error: true,
        message: "This verification code has expired",
      };
    }

    if (verificationCode.isUsed) {
      return {
        error: true,
        message: "This verification code has already been used",
      };
    }

    await ctx.db.patch("storeFrontVerificationCode", verificationCode._id, {
      isUsed: true,
    });

    let user = await ctx.db
      .query("storeFrontUser")
      .filter((q) => q.eq(q.field("email"), verificationCode.email))
      .first();

    if (!user) {
      // get the guest user
      const guestUser = await getStoreFrontActorById(ctx, args.userId);

      const id = await ctx.db.insert("storeFrontUser", {
        email: verificationCode.email,
        storeId: args.storeId,
        organizationId: args.organizationId,
        firstName: verificationCode.firstName || guestUser?.firstName,
        lastName: verificationCode.lastName || guestUser?.lastName,
      });

      user = await ctx.db.get("storeFrontUser", id);
    }

    if (!user) {
      return {
        error: true,
        message: "Could not retrieve user",
      };
    }

    // 2. Generate keys for signing tokens
    const secret = new TextEncoder().encode("your-secret-key");

    // 3. Generate tokens
    const accessToken = await new SignJWT({ userId: user._id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("15m")
      .sign(secret);

    const refreshToken = await new SignJWT({ userId: user._id })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(secret);

    await ctx.db.insert("storeFrontSession", {
      userId: user._id,
      refreshToken,
    });

    return {
      success: true,
      user,
      accessToken,
      refreshToken,
    };
  },
});

export const sendVerificationCodeViaProvider = action({
  args: {
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<any> => {
    const [data, store] = await Promise.all([
      ctx.runMutation(internal.storeFront.auth.requestVerificationCode, {
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        storeId: args.storeId,
      }),
      ctx.runQuery(internal.inventory.stores.findById, {
        id: args.storeId,
      }),
    ]);

    if (!data || !store) {
      return {
        success: false,
        message: "Could not send verification code",
      };
    }

    // return {
    //   success: true,
    //   message: "Verification code sent",
    //   data: {
    //     code: data.code,
    //     email: args.email,
    //   },
    // };

    const response = await sendVerificationCode({
      customerEmail: args.email,
      verificationCode: data.code,
      storeName: store.name,
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
