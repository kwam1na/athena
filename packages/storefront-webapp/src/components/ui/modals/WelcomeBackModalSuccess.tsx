import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  successVariants,
  checkIconVariants,
} from "./animations/welcomeBackModalAnimations";

interface WelcomeBackModalSuccessProps {
  onClose: () => void;
}

export const WelcomeBackModalSuccess: React.FC<
  WelcomeBackModalSuccessProps
> = ({ onClose }) => {
  return (
    <motion.div
      variants={successVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col items-center gap-6"
    >
      <motion.div
        variants={checkIconVariants}
        className="bg-white/20 backdrop-blur-md rounded-full p-4"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </motion.div>
      <p>Your discount code has been sent to your email</p>
      <Button
        onClick={onClose}
        className="mt-4 font-semibold py-2 sm:py-3 rounded"
      >
        Continue Shopping
      </Button>
    </motion.div>
  );
};
