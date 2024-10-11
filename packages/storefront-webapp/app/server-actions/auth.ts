import { useAppSession } from "@/utils/session";
import { createServerFn } from "@tanstack/start";
import { getCookie, setCookie } from "vinxi/http";

export const logIn = createServerFn("POST", (data?: Record<string, any>) => {
  // setHeader("athena-user-id", "1");
  return { success: true };
});

export const fetchUser = createServerFn("GET", async (_, ctx) => {
  // const session = await useAppSession();
  const customerId = getCookie("athena-customer-id");
  let guestId = getCookie("athena-guest-id");

  console.log("retrieved ->", guestId);

  if (!guestId) {
    const newGuest = {
      id: 12344,
    };

    setCookie("athena-guest-id", newGuest.id.toString(), {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
    });

    guestId = newGuest.id.toString();
  }

  // if (!session.data.userEmail) {
  //   return null;
  // }

  return {
    // email: session.data.userEmail,
    customerId,
    guestId,
  };
});

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
