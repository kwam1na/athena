import React, { useState } from "react";
import { CustomModal } from "./custom-modal";
import { Button } from "@/components/ui/button";

interface WelcomeBackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (email: string) => void;
  discountPercentage?: number;
}

export const WelcomeBackModal: React.FC<WelcomeBackModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  discountPercentage = 10,
}) => {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    if (!email || !email.includes("@")) return;

    setIsSubmitting(true);
    onSubmit(email);
    setTimeout(() => {
      setIsSubmitting(false);
      onClose();
    }, 1000);
  };

  const modalHeader = (
    <div className="text-center">
      <h2 className="text-4xl font-serif tracking-tight">
        Welcome back — this one's for you.
      </h2>
    </div>
  );

  const modalBody = (
    <div className="text-center mt-4">
      <p className="text-lg">
        Take {discountPercentage}% off your first order, just for stopping by
        again. Enter your email and we'll send you discount code to use at
        checkout.
      </p>
      <div className="mt-6">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="w-full p-4 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-lg"
        />
      </div>
    </div>
  );

  const modalFooter = (
    <div className="flex flex-col w-full gap-4 mt-2">
      <Button
        className="w-full py-6 bg-orange-500 hover:bg-orange-600 text-white text-lg font-medium rounded-md"
        onClick={handleSubmit}
        disabled={isSubmitting || !email || !email.includes("@")}
      >
        {isSubmitting ? "Sending..." : "Send My Code"}
      </Button>
      <Button
        variant="ghost"
        className="text-sm text-gray-600 hover:text-gray-800"
        onClick={onClose}
      >
        No thanks
      </Button>
    </div>
  );

  return (
    <CustomModal
      isOpen={isOpen}
      onClose={onClose}
      header={modalHeader}
      body={modalBody}
      footer={modalFooter}
      size="md"
      hideCloseButton={true}
      contentClassName="p-8"
    />
  );
};
