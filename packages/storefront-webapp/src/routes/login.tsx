import { getActiveUser } from "@/api/storeFrontUser";
import { verifyUserAccount } from "@/api/stores";
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
import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const customerDetailsSchema = z.object({
  email: z
    .string()
    .email("Invalid email")
    .refine(
      (value) => value.trim().length > 0,
      "Email cannot be empty or whitespace"
    ),
});

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);

    const { storeId, organizationId } = getStoreDetails();

    try {
      if (id && storeId && organizationId) {
        const user = await getActiveUser({
          storeId,
          organizationId,
          userId: id || "",
        });

        if (user._id) {
          return redirect({ to: "/account" });
        }
      }
    } catch (e) {
      localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
      return redirect({ to: "/login" });
    }
  },

  component: () => <Login />,
});

const Login = () => {
  const form = useForm({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: {
      email: "",
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
      organizationId: store.organizationId,
      storeId: store._id,
    });
  };

  if (!store) return <div className="h-screen" />;

  return (
    <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
      <div className="space-y-8 py-16">
        {/* <h1 className="text-xl font-medium">Login for faster checkout.</h1> */}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-8 flex flex-col items-center p-12"
          >
            <div className="space-y-8 w-[320px] md:w-[400px]">
              <p className="text-lg">{`Login to your ${store?.name && capitalizeWords(store?.name as string)} account`}</p>
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
                className="w-[96px]"
                isLoading={verifyMutation.isPending}
                type="submit"
              >
                Continue
              </LoadingButton>

              <div className="flex gap-2 pt-4">
                <p className="text-sm text-muted-foreground">
                  Don't have an account?
                </p>
                <Link
                  to="/signup"
                  className="flex items-center gap-1 hover:underline"
                >
                  <p className="text-sm">Create yours now.</p>
                </Link>
              </div>
            </div>
          </form>
        </Form>
      </div>
    </FadeIn>
  );
};
