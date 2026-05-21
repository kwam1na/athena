import { convexAuth } from "@convex-dev/auth/server";
import { EmailOTP } from "./otp/EmailOTP";
import { athenaAuthJwtConfig, athenaAuthSessionConfig } from "./authConfig";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [EmailOTP],
  session: athenaAuthSessionConfig,
  jwt: athenaAuthJwtConfig,
});
