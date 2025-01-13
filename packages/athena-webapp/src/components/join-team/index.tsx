import { useMutation } from "convex/react";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import { toast } from "sonner";
import { LOGGED_IN_USER_ID_KEY } from "~/src/lib/constants";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";

export const JoinTeam = () => {
  const redeemCode = useMutation(api.inventory.inviteCode.redeem);

  const [isRedeeming, setIsRedeeming] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleRedeemCode = async () => {
    if (!code || !email) return;

    setIsRedeeming(true);
    try {
      const res = await redeemCode({ code, email });

      if (res.success) {
        console.log("success");

        const { recipientUserId } = res.inviteCode || {};

        if (recipientUserId) {
          localStorage.setItem(LOGGED_IN_USER_ID_KEY, recipientUserId);

          navigate({ to: "/" });
        }
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error("An error occurred", {
        description: (e as Error).message,
      });
    } finally {
      setIsRedeeming(false);
    }
  };

  const providedAllFields =
    code && email && code.trim() !== "" && email.trim() !== "";

  return (
    <div className="container mx-auto max-w-[1024px] px-0 flex items-center justify-center h-[calc(100vh-64px)]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: "easeInOut" },
        }}
        className="space-y-4"
      >
        <h1 className="text-2xl text-center font-bold">Join a team</h1>
        <p className="text-sm mt-2">
          Enter your email and the code you received
        </p>

        <div className="mx-auto w-64 flex items-center justify-center flex-col gap-4">
          <Input
            type="email"
            placeholder="Email"
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            placeholder="XXXXXX"
            onChange={(e) => setCode(e.target.value)}
          />

          <LoadingButton
            onClick={handleRedeemCode}
            disabled={!providedAllFields}
            isLoading={isRedeeming}
            className="w-[96px] mt-4"
          >
            Continue
          </LoadingButton>
        </div>
      </motion.div>
    </div>
  );
};
