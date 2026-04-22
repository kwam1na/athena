import { convexAuth } from "@convex-dev/auth/server";
import { EmailOTP } from "./otp/EmailOTP";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [EmailOTP],
});
