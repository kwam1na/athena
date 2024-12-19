import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export default function CheckoutExpired() {
  return (
    <div className="h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-3xl font-light">
            Your checkout session has expired
          </p>

          <p className="text-xs">
            You've been inactive for a while, so we ended your session to secure
            your information.
          </p>
        </div>

        <Link to="/shop/bag">
          <Button className="lg:w-[320px]">Return to bag</Button>
        </Link>
      </div>
    </div>
  );
}
