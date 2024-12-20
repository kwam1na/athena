import { createGuest } from "@/api/guest";
import { useAppSession } from "@/utils/session";
import { createServerFn } from "@tanstack/start";
import { getCookie, setCookie } from "vinxi/http";

export const logIn = createServerFn("POST", (data?: Record<string, any>) => {
  return { success: true };
});

export const fetchUser = createServerFn(
  "GET",
  async (organizationId: string, ctx) => {
    // const session = await useAppSession();
    const customerId = getCookie("athena-customer-id");
    let guestId = getCookie("athena-guest-id");

    if (!guestId) {
      const newGuest = await createGuest(organizationId);

      console.log("no guest id. creating new one..");

      setCookie("athena-guest-id", newGuest.id.toString(), {
        httpOnly: true,
        secure: true,
        sameSite: "none",
      });

      guestId = newGuest.id;
    }

    return {
      customerId,
      guestId,
    };
  }
);

export const loginFn = createServerFn(
  "POST",
  async (
    payload: {
      email: string;
      password: string;
    },
    { request }
  ) => {
    // Find the user
    const user = {};

    // Check if the user exists
    if (!user) {
      return {
        error: true,
        userNotFound: true,
        message: "User not found",
      };
    }

    const salt = "salt";

    // Check if the password is correct
    // const hashedPassword = await hashPassword(payload.password, salt)

    // if (user.password !== hashedPassword) {
    //   return {
    //     error: true,
    //     message: 'Incorrect password',
    //   }
    // }

    // Create a session
    const session = await useAppSession();

    // Store the user's email in the session
    await session.update({
      userEmail: "email",
    });

    setCookie("athena-user-id", "1", {
      httpOnly: true, // Makes the cookie inaccessible to JavaScript (for security)
      secure: true, // Ensures the cookie is sent over HTTPS only
      sameSite: "strict", // Controls cross-site request behavior
      maxAge: 60 * 60 * 24 * 7, // Set expiration (1 week in this case)
    });

    return {
      error: false,
      userNotFound: false,
      message: "Logged in",
    };
  }
);
