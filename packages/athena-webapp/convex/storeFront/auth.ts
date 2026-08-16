import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  MutationCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { sendVerificationCode } from "../mailersend";
import { internal } from "../_generated/api";
import { SignJWT } from "jose";
import {
  sendVerificationCodeViaProviderOperationDefinition,
  verifyCodeOperationDefinition,
} from "../operationAdmission/domains/u6_storefrontCustomer_definitions";
import {
  admitPublicAction,
  admitPublicMutation,
} from "../platform/operationAdmission";
import {
  assertCustomerOwnsStore,
  assertCustomerOwnsStoreIfPropagated,
  customerOwnerActorId,
  customerOwnerValidator,
  denyCustomerOwnership,
} from "./customerOwnership";

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

const verifyCodeArgs = {
  code: v.string(),
  email: v.string(),
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  userId: v.union(v.id("storeFrontUser"), v.id("guest")),
};

type VerifyCodeArgs = {
  code: string;
  email: string;
  storeId: Id<"store">;
  organizationId: Id<"organization">;
  userId: Id<"storeFrontUser"> | Id<"guest">;
};

async function verifyCodeWithCtx(ctx: MutationCtx, args: VerifyCodeArgs) {
  {
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
  }
}

export const verifyCode = mutation({
  args: verifyCodeArgs,
  handler: admitPublicMutation(
    verifyCodeOperationDefinition,
    async (ctx, args: VerifyCodeArgs) => verifyCodeWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for the `POST /auth/verify` route (wave B2 flips it here).
 *
 * `owner` is optional because this IS the pre-auth step: a shopper arriving to
 * prove an email may hold only a guest marker, or no claim at all. When the
 * route does have an admitted claim it must propagate it, and the code is then
 * only accepted for that shopper's own id and store — a bearer id for another
 * shopper cannot mint a session here.
 */
export const verifyCodeInternal = internalMutation({
  args: { ...verifyCodeArgs, owner: v.optional(customerOwnerValidator) },
  handler: async (ctx, { owner, ...args }) => {
    if (owner) {
      assertCustomerOwnsStore(owner, args.storeId);
      if (String(args.userId) !== String(customerOwnerActorId(owner))) {
        denyCustomerOwnership();
      }
    }
    return await verifyCodeWithCtx(ctx, args);
  },
});

const sendVerificationCodeViaProviderArgs = {
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  storeId: v.id("store"),
};

type SendVerificationCodeViaProviderArgs = {
  email: string;
  firstName?: string;
  lastName?: string;
  storeId: Id<"store">;
};

async function sendVerificationCodeViaProviderWithCtx(
  ctx: { runMutation: any; runQuery: any },
  args: SendVerificationCodeViaProviderArgs,
): Promise<any> {
  {
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
  }
}

/**
 * The retired `denySharedDemoEffectIfApplicable` call is now
 * `actors.sharedDemo: "deny"` on the definition: the refusal happens at
 * admission, before the OTP row is written and before the provider is called,
 * rather than inside the body after the fact.
 */
export const sendVerificationCodeViaProvider = action({
  args: sendVerificationCodeViaProviderArgs,
  handler: admitPublicAction(
    sendVerificationCodeViaProviderOperationDefinition,
    async (ctx, args: SendVerificationCodeViaProviderArgs): Promise<any> =>
      sendVerificationCodeViaProviderWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for the `POST /auth/verify` route. `owner` is optional for
 * the same pre-auth reason as `verifyCodeInternal`; when propagated, a code may
 * only be sent for the store the claim clamped to.
 */
export const sendVerificationCodeViaProviderInternal = internalAction({
  args: {
    ...sendVerificationCodeViaProviderArgs,
    owner: v.optional(customerOwnerValidator),
  },
  handler: async (ctx, { owner, ...args }): Promise<any> => {
    assertCustomerOwnsStoreIfPropagated(owner, args.storeId);
    return await sendVerificationCodeViaProviderWithCtx(ctx, args);
  },
});
