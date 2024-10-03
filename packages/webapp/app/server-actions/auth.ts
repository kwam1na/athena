import { useAppSession } from "@/utils/session";
import { createServerFn } from "@tanstack/start";
import { setCookie } from "vinxi/http";

export const logIn = createServerFn("POST", (data?: Record<string, any>) => {
  // setHeader("athena-user-id", "1");
  return { success: true };
});

export const fetchUser = createServerFn("GET", async () => {
  // We need to auth on the server so we have access to secure cookies
  const session = await useAppSession();

  console.log("returned session ->", session.data);

  if (!session.data.userEmail) {
    return null;
  }

  return {
    email: session.data?.userEmail,
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

    console.log("setting cookie");

    setCookie("athena-user-id", "1", {
      httpOnly: true, // Makes the cookie inaccessible to JavaScript (for security)
      secure: false, // Ensures the cookie is sent over HTTPS only
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
