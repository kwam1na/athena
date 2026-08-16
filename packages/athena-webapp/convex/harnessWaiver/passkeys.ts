"use node";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { waiverCandidateSchema } from "../schemas/harnessWaiver";
import { waiverPasskeyConfig } from "./config";
import {
  type WaiverCandidate,
} from "./passkeyPolicy";

const REGISTRATION_TTL_MS = 5 * 60_000;
const APPROVAL_TTL_MS = 15 * 60_000;
export const APPROVED_CONSUMPTION_TTL_MS = 10 * 60_000;

function randomToken(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

async function sha256(value: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))
    .toString("hex");
}

export function registrationCeremonyPolicy(reviewerEmail: string, rpId: string) {
  return {
    rpName: "Athena waiver approval",
    rpID: rpId,
    userName: reviewerEmail,
    userDisplayName: reviewerEmail,
    attestationType: "none" as const,
    authenticatorSelection: {
      authenticatorAttachment: "platform" as const,
      residentKey: "required" as const,
      userVerification: "required" as const,
    },
    preferredAuthenticatorType: "localDevice" as const,
  };
}

export function verificationPolicy(challenge: string, origin: string, rpId: string) {
  return {
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
  };
}

export function authenticationChallengeBytes(challenge: string) {
  return new Uint8Array(Buffer.from(challenge, "base64url"));
}

export const beginRegistration = action({
  args: { authorizationToken: v.string() },
  handler: async (ctx, args) => {
    const authorization = await ctx.runMutation(
      internal.harnessWaiver.storage.consumeRegistrationAuthorization,
      { tokenHash: await sha256(args.authorizationToken), now: Date.now() },
    );
    const reviewerEmail = authorization.reviewerEmail;
    const existing = await ctx.runQuery(internal.harnessWaiver.storage.getPasskey, {});
    if (existing) throw new Error("A waiver passkey is already enrolled.");
    const config = waiverPasskeyConfig();
    const options = await generateRegistrationOptions(
      registrationCeremonyPolicy(reviewerEmail, config.rpId),
    );
    await ctx.runMutation(internal.harnessWaiver.storage.saveRegistrationChallenge, {
      challenge: options.challenge,
      reviewerEmail,
      expiresAt: Date.now() + REGISTRATION_TTL_MS,
    });
    return options;
  },
});

export const completeRegistration = action({
  args: { challenge: v.string(), response: v.any() },
  handler: async (ctx, args) => {
    const response = args.response as RegistrationResponseJSON;
    const registration = await ctx.runQuery(
      internal.harnessWaiver.storage.getRegistrationChallenge,
      { challenge: args.challenge },
    );
    if (!registration || registration.expiresAt <= Date.now() || registration.consumedAt) {
      throw new Error("Registration challenge is unavailable.");
    }
    const reviewerEmail = registration.reviewerEmail;
    const config = waiverPasskeyConfig();
    const verification = await verifyRegistrationResponse({
      response,
      ...verificationPolicy(registration.challenge, config.origin, config.rpId),
    });
    if (!verification.verified) throw new Error("Passkey registration was not verified.");
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await ctx.runMutation(internal.harnessWaiver.storage.completeRegistration, {
      challenge: registration.challenge,
      reviewerEmail,
      credentialId: credential.id,
      publicKey: credential.publicKey.buffer.slice(
        credential.publicKey.byteOffset,
        credential.publicKey.byteOffset + credential.publicKey.byteLength,
      ),
      counter: credential.counter,
      transports: response.response.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      now: Date.now(),
    });
    return { enrolled: true };
  },
});

export const createApprovalRequest = internalAction({
  args: { candidate: waiverCandidateSchema },
  handler: async (ctx, args): Promise<{
    approvalId: Id<"harnessWaiverApproval">;
    approvalUrl: string;
  }> => {
    const credential: Doc<"harnessWaiverPasskey"> | null = await ctx.runQuery(
      internal.harnessWaiver.storage.getPasskey,
      {},
    );
    if (!credential) throw new Error("The waiver reviewer passkey is not enrolled.");
    const config = waiverPasskeyConfig();
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: [{
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      }],
      userVerification: "required",
    });
    const publicToken = randomToken();
    const candidate = args.candidate as WaiverCandidate;
    const approvalId: Id<"harnessWaiverApproval"> = await ctx.runMutation(
      internal.harnessWaiver.storage.createApproval,
      {
        publicTokenHash: await sha256(publicToken),
        challenge: options.challenge,
        candidate,
        expiresAt: Date.now() + APPROVAL_TTL_MS,
        createdAt: Date.now(),
      },
    );
    return {
      approvalId,
      approvalUrl: `${config.approvalUrl}?token=${encodeURIComponent(publicToken)}`,
    };
  },
});

export const getApprovalOptions = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{
    approvalId: Id<"harnessWaiverApproval">;
    candidate: WaiverCandidate;
    options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  }> => {
    const approval: Doc<"harnessWaiverApproval"> | null = await ctx.runQuery(
      internal.harnessWaiver.storage.getApprovalByTokenHash,
      { publicTokenHash: await sha256(args.token) },
    );
    if (!approval || approval.status !== "pending" || approval.expiresAt <= Date.now()) {
      throw new Error("Approval request is unavailable.");
    }
    const credential: Doc<"harnessWaiverPasskey"> | null = await ctx.runQuery(
      internal.harnessWaiver.storage.getPasskey,
      {},
    );
    if (!credential) throw new Error("The waiver reviewer passkey is not enrolled.");
    return {
      approvalId: approval._id,
      candidate: approval.candidate,
      options: await generateAuthenticationOptions({
        rpID: waiverPasskeyConfig().rpId,
        challenge: authenticationChallengeBytes(approval.challenge),
        allowCredentials: [{
          id: credential.credentialId,
          transports: credential.transports as AuthenticatorTransportFuture[],
        }],
        userVerification: "required",
      }),
    };
  },
});

export const completeApproval = action({
  args: { token: v.string(), response: v.any() },
  handler: async (ctx, args) => {
    const approval = await ctx.runQuery(internal.harnessWaiver.storage.getApprovalByTokenHash, {
      publicTokenHash: await sha256(args.token),
    });
    if (!approval || approval.status !== "pending" || approval.expiresAt <= Date.now()) {
      throw new Error("Approval request is unavailable.");
    }
    const credential = await ctx.runQuery(internal.harnessWaiver.storage.getPasskey, {});
    if (!credential) throw new Error("The waiver reviewer passkey is not enrolled.");
    const config = waiverPasskeyConfig();
    const verification = await verifyAuthenticationResponse({
      response: args.response as AuthenticationResponseJSON,
      ...verificationPolicy(approval.challenge, config.origin, config.rpId),
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) throw new Error("Passkey approval was not verified.");
    await ctx.runMutation(internal.harnessWaiver.storage.approve, {
      approvalId: approval._id as Id<"harnessWaiverApproval">,
      credentialId: credential.credentialId,
      newCounter: verification.authenticationInfo.newCounter,
      approvedAt: Date.now(),
      consumeExpiresAt: Date.now() + APPROVED_CONSUMPTION_TTL_MS,
    });
    return { approved: true };
  },
});
