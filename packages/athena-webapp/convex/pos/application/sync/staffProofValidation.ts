import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { hashPosLocalStaffProofToken } from "./staffProof";

export type PosLocalStaffProofValidationFailureReason =
  | "proof_not_found"
  | "proof_inactive"
  | "proof_scope_mismatch"
  | "proof_expired"
  | "credential_not_found"
  | "credential_inactive"
  | "credential_scope_mismatch"
  | "credential_version_mismatch";

export type PosLocalStaffProofValidationResult =
  | {
      kind: "ok";
      credential: Doc<"staffCredential">;
      proof: Doc<"posLocalStaffProof">;
    }
  | {
      kind: "rejected";
      reason: PosLocalStaffProofValidationFailureReason;
    };

export async function validatePosLocalStaffProofWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    now: number;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    token: string;
    touchLastUsed?: boolean;
  },
): Promise<PosLocalStaffProofValidationResult> {
  const tokenHash = await hashPosLocalStaffProofToken(args.token);
  let proof: Doc<"posLocalStaffProof"> | null;
  try {
    proof = await ctx.db
      .query("posLocalStaffProof")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
  } catch {
    return { kind: "rejected", reason: "proof_not_found" };
  }

  if (!proof) {
    return { kind: "rejected", reason: "proof_not_found" };
  }

  if (proof.status !== "active") {
    return { kind: "rejected", reason: "proof_inactive" };
  }

  if (
    proof.staffProfileId !== args.staffProfileId ||
    proof.storeId !== args.storeId ||
    proof.terminalId !== args.terminalId
  ) {
    return { kind: "rejected", reason: "proof_scope_mismatch" };
  }

  if (proof.expiresAt <= args.now) {
    return { kind: "rejected", reason: "proof_expired" };
  }

  const credential = await ctx.db.get("staffCredential", proof.credentialId);
  if (!credential) {
    return { kind: "rejected", reason: "credential_not_found" };
  }

  if (credential.status !== "active") {
    return { kind: "rejected", reason: "credential_inactive" };
  }

  if (
    credential.staffProfileId !== args.staffProfileId ||
    credential.storeId !== args.storeId
  ) {
    return { kind: "rejected", reason: "credential_scope_mismatch" };
  }

  if (credential.localVerifierVersion !== proof.credentialVersion) {
    return { kind: "rejected", reason: "credential_version_mismatch" };
  }

  if (args.touchLastUsed !== false) {
    await ctx.db.patch("posLocalStaffProof", proof._id, {
      lastUsedAt: args.now,
    });
  }

  return { kind: "ok", credential, proof };
}
