import { convexAuth } from "@convex-dev/auth/server";
import { EmailOTP } from "./otp/EmailOTP";
import { athenaAuthJwtConfig, athenaAuthSessionConfig } from "./authConfig";
import { PosRecoveryCode } from "./auth/PosRecoveryCode";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [EmailOTP, PosRecoveryCode],
  session: athenaAuthSessionConfig,
  jwt: athenaAuthJwtConfig,
});
