import { getActiveUser } from "@/api/storeFrontUser";
import { verifyUserAccount } from "@/api/auth";
import { AuthComponent } from "@/components/auth/Auth";
import { FadeIn } from "@/components/common/FadeIn";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { useStoreContext } from "@/contexts/StoreContext";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";
import { capitalizeWords, getStoreDetails } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const nameRegex = /^[a-zA-Zà-öø-ÿÀ-ÖØ-ß\-'\.\s]+$/;

export const customerDetailsSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .regex(nameRegex, "First name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "First name cannot be empty or whitespace"
    ),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .regex(nameRegex, "Last name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "Last name cannot be empty or whitespace"
    ),
  email: z
    .string()
    .email("Invalid email")
    .refine(
      (value) => value.trim().length > 0,
      "Email cannot be empty or whitespace"
    ),
});

export const Route = createFileRoute("/signup")({
  beforeLoad: async () => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);

    const { storeId, organizationId } = getStoreDetails();

    try {
      if (id && storeId && organizationId) {
        const user = await getActiveUser();

        if (user._id) {
          return redirect({ to: "/account" });
        }
      }
    } catch (e) {
      localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
      return redirect({ to: "/login" });
    }
  },

  component: () => <Signup />,
});

const Signup = () => {
  const form = useForm({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
    },
  });

  const { store } = useStoreContext();

  const navigate = useNavigate();

  const verifyMutation = useMutation({
    mutationFn: verifyUserAccount,
    onSuccess: (res) => {
      if (res.success) {
        navigate({
          to: "/auth/verify",
          search: {
            email: res.data.email,
          },
        });
      }
    },
    onError: (error) => {
      console.log("error", error);
    },
  });

  if (!store) return <div className="h-screen" />;

  const onSubmit = async (data: z.infer<typeof customerDetailsSchema>) => {
    verifyMutation.mutate({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
    });
  };

  return (
    <AuthComponent>
      <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
        <div className="space-y-8 py-16">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-8 flex flex-col items-center p-12"
            >
              <div className="space-y-8 w-[320px] md:w-[400px]">
                <p className="text-lg">{`Create your ${store?.name && capitalizeWords(store?.name as string)} account`}</p>
                <div className="w-full">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="First name" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="w-full">
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="Last name" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="w-full">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...field} placeholder="Email" type="email" />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <LoadingButton
                  className="group"
                  variant={"clear"}
                  isLoading={verifyMutation.isPending}
                  type="submit"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                </LoadingButton>

                <div>
                  <p className="text-sm text-muted-foreground">
                    By creating an account, you agree to our{" "}
                    <Link
                      to="/policies/tos"
                      className="text-primary hover:underline"
                    >
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link
                      to="/policies/privacy"
                      className="text-primary hover:underline"
                    >
                      Privacy Policy.
                    </Link>
                  </p>
                </div>

                <div className="flex gap-2 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Already have an account?
                  </p>
                  <Link
                    to="/login"
                    className="flex items-center group hover:underline"
                  >
                    <p className="text-sm">Login</p>
                    <ArrowRight className="w-3.5 h-3.5 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </div>
            </form>
          </Form>
        </div>
      </FadeIn>
    </AuthComponent>
  );
};
