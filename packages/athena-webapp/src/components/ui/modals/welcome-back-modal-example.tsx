import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { WelcomeBackModal } from "./welcome-back-modal";

export const WelcomeBackModalExample: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSubmit = (email: string) => {
    console.log(`Discount code sent to: ${email}`);
    // In a real application, you would send the request to your backend
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-2xl font-bold">Welcome Back Modal Example</h1>

      <div className="flex flex-col gap-4 w-full max-w-md">
        <Button onClick={() => setIsModalOpen(true)} className="p-6">
          Show Welcome Back Modal
        </Button>

        <div className="text-sm text-gray-500">
          <p>
            Click the button above to open the welcome back modal offering a
            discount.
          </p>
        </div>
      </div>

      <WelcomeBackModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        discountPercentage={10}
      />
    </div>
  );
};
