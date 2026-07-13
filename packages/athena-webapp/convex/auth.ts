import { convexAuth } from "@convex-dev/auth/server";
import { EmailOTP } from "./otp/EmailOTP";
import { athenaAuthJwtConfig, athenaAuthSessionConfig } from "./authConfig";
import { PosRecoveryCode } from "./auth/PosRecoveryCode";
import { SharedDemoTicket } from "./auth/SharedDemoTicket";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [EmailOTP, PosRecoveryCode, SharedDemoTicket],
  session: athenaAuthSessionConfig,
  jwt: athenaAuthJwtConfig,
});
