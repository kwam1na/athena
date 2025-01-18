import { v } from "convex/values";
import { action, mutation } from "../_generated/server";
import { sendVerificationCode } from "../sendgrid";
import { api } from "../_generated/api";
import { SignJWT } from "jose";

const expirationTimeInMinutes = 10;

export const requestVerificationCode = mutation({
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

    console.log("inserted....");

    return await ctx.db.get(id);
  },
});

export const verifyCode = mutation({
  args: {
    code: v.string(),
    email: v.string(),
  },
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

    await ctx.db.patch(verificationCode._id, {
      isUsed: true,
    });

    let user = await ctx.db
      .query("athenaUser")
      .filter((q) => q.eq(q.field("email"), verificationCode.email))
      .first();

    if (!user) {
      const id = await ctx.db.insert("athenaUser", {
        email: verificationCode.email,
        firstName: verificationCode.firstName,
        lastName: verificationCode.lastName,
      });

      user = await ctx.db.get(id);
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

    // await ctx.db.insert("storeFrontSession", {
    //   userId: user._id,
    //   refreshToken,
    // });

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
  },
  handler: async (ctx, args) => {
    // const [data, store] = await Promise.all([
    //   ctx.runMutation(api.inventory.auth.requestVerificationCode, {
    //     email: args.email,
    //     firstName: args.firstName,
    //     lastName: args.lastName,
    //   }),
    //   ctx.runQuery(api.inventory.stores.findById, {
    //     id: args.storeId,
    //   }),
    // ]);

    const data: any = await ctx.runMutation(
      api.inventory.auth.requestVerificationCode,
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

    // return {
    //   success: true,
    //   message: "Verification code sent mofo!!!",
    //   data: {
    //     email: data.email,
    //     code: data.code,
    //   },
    //   // d: data,
    // };

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
