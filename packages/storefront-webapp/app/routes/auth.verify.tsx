import { verifyUserAccount } from "@/api/stores";
import { FadeIn } from "@/components/common/FadeIn";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { LoadingButton } from "@/components/ui/loading-button";
import { useStoreContext } from "@/contexts/StoreContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useMutation } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { set, z } from "zod";

export const FormSchema = z.object({
  code: z.string().min(6, {
    message: "Your one-time verification code must be 6 characters.",
  }),
});

export const Route = createFileRoute("/auth/verify")({
  component: InputOTPForm,
});

function InputOTPForm() {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      code: "",
    },
  });

  // const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // const { signIn } = useAuthActions();

  const { email } = useSearch({ strict: false });

  const navigate = useNavigate();

  const { store } = useStoreContext();

  // Automatically submit the form when 6 digits are entered
  const handleCodeChange = (newValue: string) => {
    form.setValue("code", newValue);

    if (newValue.length === 6) {
      form.handleSubmit(onSubmit)();
    }
  };

  const verifyMutation = useMutation({
    mutationFn: verifyUserAccount,
    onSuccess: (res) => {
      if (res.error) {
        setErrorMessage(res.message);
      } else {
        setErrorMessage(null);
      }

      console.log("res", res);
      if (res.success) {
        toast.success("Successfully logged you in.");
      }
      //   navigate({
      //     to: "/auth/verify",
      //   });
    },
    onError: (error) => {
      console.log("error", error);
      setErrorMessage(
        "There was an error verifying your account. Please try again."
      );
    },
  });

  const resendVerificationCodeMutation = useMutation({
    mutationFn: verifyUserAccount,
    onSuccess: (res) => {
      console.log("res", res);

      if (res.error) {
        setErrorMessage(res.message);
      } else {
        setErrorMessage(null);
      }

      if (res.success) {
        toast.success("Verification code sent to your email.");
      }
      //   navigate({
      //     to: "/auth/verify",
      //   });
    },
    onError: (error) => {
      console.log("error", error);
      setErrorMessage(error.message);
    },
  });

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    verifyMutation.mutate({
      organizationId: store.organizationId,
      storeId: store._id,
      email,
      code: data.code,
    });
  };

  const resendVerificationCode = async () => {
    if (!email) {
      setErrorMessage("Email is required to resend verification code");
      return;
    }
    resendVerificationCodeMutation.mutate({
      organizationId: store.organizationId,
      storeId: store._id,
      email,
    });
  };

  if (!store) return <div className="h-screen" />;

  return (
    <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
      <div className="space-y-8">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-8 flex flex-col items-center pt-40"
          >
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem className="space-y-4 flex flex-col items-center">
                  {/* <FormLabel>One-Time Code</FormLabel> */}
                  <FormControl>
                    <InputOTP
                      maxLength={6}
                      {...field}
                      onChange={handleCodeChange}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </FormControl>
                  <FormDescription>
                    {errorMessage
                      ? errorMessage
                      : `Enter the one-time code sent to ${email ?? "your email address"}`}
                  </FormDescription>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <LoadingButton
              className="w-[96px]"
              isLoading={verifyMutation.isPending}
              type="submit"
            >
              Continue
            </LoadingButton>
          </form>
        </Form>

        <div className="flex w-full flex-col gap-4 items-center">
          <p className="text-center text-sm font-normal text-primary/60">
            Did not receive a code?
          </p>
          <LoadingButton
            onClick={resendVerificationCode}
            isLoading={resendVerificationCodeMutation.isPending}
            variant="ghost"
          >
            <p className="text-sm">Request New Code</p>
          </LoadingButton>
          <Link
            className="flex items-center gap-2 text-muted-foreground hover:underline hover:cursor-pointer"
            to="/login"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" />
            <p className="text-sm">Back to Login</p>
          </Link>
        </div>
      </div>
    </FadeIn>
  );
}
