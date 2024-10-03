import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/start";
import { Auth } from "./Auth";
import { useMutation } from "@tanstack/react-query";
// import { signupFn } from "@/routes/signup";
// import { loginFn } from "@/server-actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// export function Login() {
//   const router = useRouter();

//   const loginMutation = useMutation({
//     mutationFn: loginFn,
//     onSuccess: async (ctx) => {
//       if (!ctx.userNotFound) {
//         await router.invalidate();
//         router.navigate({ to: "/" });
//         return;
//       }
//     },
//   });

//   const signupMutation = useMutation({
//     mutationFn: useServerFn(signupFn),
//     onSuccess: () => {
//       router.navigate({ to: "/" });
//     },
//   });

//   return (
//     <Auth
//       actionText="Login"
//       status={loginMutation.status}
//       onSubmit={(e) => {
//         const formData = new FormData(e.target as HTMLFormElement);

//         loginMutation.mutate({
//           email: formData.get("email") as string,
//           password: formData.get("password") as string,
//         });
//       }}
//       afterSubmit={
//         loginMutation.data ? (
//           <>
//             <div className="text-red-400">{loginMutation.data.message}</div>
//             {loginMutation.data.userNotFound ? (
//               <div>
//                 <button
//                   className="text-blue-500"
//                   onClick={(e) => {
//                     const formData = new FormData(
//                       (e.target as HTMLButtonElement).form!
//                     );

//                     signupMutation.mutate({
//                       email: formData.get("email") as string,
//                       password: formData.get("password") as string,
//                     });
//                   }}
//                   type="button"
//                 >
//                   Sign up instead?
//                 </button>
//               </div>
//             ) : null}
//           </>
//         ) : null
//       }
//     />
//   );
// }

export function Login() {
  const router = useRouter();

  // const loginMutation = useMutation({
  //   mutationFn: loginFn,
  //   onSuccess: async (ctx) => {
  //     if (!ctx.userNotFound) {
  //       await router.invalidate();
  //       router.navigate({ to: "/" });
  //       return;
  //     }
  //   },
  // });

  return (
    <div className="w-full h-screen flex items-center">
      <Card className="mx-auto max-w-sm w-[420px]">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              // const formData = new FormData(e.target as HTMLFormElement);

              // loginMutation.mutate({
              //   email: formData.get("email") as string,
              //   password: formData.get("password") as string,
              // });
              e.preventDefault();

              // loginMutation.mutate({
              //   email: "email",
              //   password: "password",
              // });
            }}
          >
            <div className="grid gap-4">
              <Button type="submit" className="w-full">
                Login
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
