import { FadeIn } from "@/components/common/FadeIn";
import { Lock } from "lucide-react";

export const CheckoutUnavailable = () => {
  return (
    <FadeIn className="container mx-auto px-4 lg:px-0 overflow-hidden">
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-muted-foreground font-medium">
          <Lock className="w-4 h-4" />
          <p className="tex-sm text-center">
            Store checkout is currently unavailable
          </p>
        </div>
      </div>
    </FadeIn>
  );
};
