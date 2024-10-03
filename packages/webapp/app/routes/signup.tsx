import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/start";
import { updateSession } from "vinxi/http";
import { hashPassword } from "@/utils";
import { Auth } from "@/components/auth/Auth";
import { useAppSession } from "@/utils/session";
import { useMutation } from "@tanstack/react-query";

export const signupFn = createServerFn(
  "POST",
  async (payload: {
    email: string;
    password: string;
    redirectUrl?: string;
  }) => {
    // Check if the user already exists
    const found = {};

    const salt = "salt";

    // Encrypt the password using Sha256 into plaintext
    const password = await hashPassword(payload.password, salt);

    // Create a session
    const session = await useAppSession();

    if (found) {
      //   if (found.password !== password) {
      //     return {
      //       error: true,
      //       userExists: true,
      //       message: 'User already exists',
      //     }
      //   }

      // Store the user's email in the session
      await session.update({
        userEmail: "email",
      });

      // Redirect to the prev page stored in the "redirect" search param
      throw redirect({
        href: payload.redirectUrl || "/",
      });
    }

    // Create the user
    const user = {};

    // Store the user's email in the session
    await session.update({
      userEmail: "email",
    });

    // Redirect to the prev page stored in the "redirect" search param
    throw redirect({
      href: payload.redirectUrl || "/",
    });
  }
);

export const Route = createFileRoute("/signup")({
  component: SignupComp,
});

function SignupComp() {
  const signupMutation = useMutation({
    mutationFn: useServerFn(signupFn),
  });

  return (
    <Auth
      actionText="Sign Up"
      status={signupMutation.status}
      onSubmit={(e) => {
        const formData = new FormData(e.target as HTMLFormElement);

        signupMutation.mutate({
          email: formData.get("email") as string,
          password: formData.get("password") as string,
        });
      }}
      //   afterSubmit={
      //     signupMutation.data?.error ? (
      //       <>
      //         <div className="text-red-400">{signupMutation.data.message}</div>
      //       </>
      //     ) : null
      //   }
    />
  );
}
