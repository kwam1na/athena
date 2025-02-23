import { useCheckout } from "@/components/checkout/CheckoutProvider";
import { Button } from "@/components/ui/button";
import { useGetActiveCheckoutSession } from "@/hooks/useGetActiveCheckoutSession";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function CheckoutExpired() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-2xl">Your checkout session has expired</p>

          <p>
            You've been inactive for a while, so we ended your session to secure
            your information.
          </p>
        </div>

        <Link to="/shop/bag">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to bag
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutSessionNotFound() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">This checkout session does not exists</p>
        </div>

        <Link to="/shop/bag">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to bag
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function CheckoutSessionGeneric({ message }: { message: string }) {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">{message}</p>
        </div>

        <Link to="/shop/checkout">
          <Button variant={"clear"} className="group px-0">
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Return to checkout
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function UnableToVerifyCheckoutPayment() {
  const { data: activeSession } = useGetActiveCheckoutSession();

  const supportEmail = "kwami.nuh@gmail.com";

  const handleSendEmail = () => {
    const subject = "Support Request: Payment Verification Issue";
    const body = `Reference: ${activeSession?.externalReference || activeSession?._id}`;
    const mailtoLink = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  };

  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">
            We couldn't find your payment information. Please try again. If this
            continues,{" "}
            <button
              onClick={handleSendEmail}
              className="text-accent2 hover:underline inline-block"
            >
              contact us
            </button>{" "}
            for support.
          </p>

          <p className="font-medium">{`Reference: ${activeSession?.externalReference || activeSession?._id}`}</p>
        </div>

        <div className="flex items-center gap-8">
          <Link to="/shop/bag">
            <Button variant={"clear"} className="group px-0">
              <ArrowLeft className="w-4 h-4 mr-2 transition-transform group-hover:translate-x-0.5" />
              Return to bag
            </Button>
          </Link>

          <Link to="/shop/checkout/verify">
            <Button
              onClick={() => window.location.reload()}
              variant={"clear"}
              className="group px-0"
            >
              Try again
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
export function SendSupportEmail({ supportEmail }: { supportEmail: string }) {
  const { data: activeSession } = useGetActiveCheckoutSession();

  const handleSendEmail = () => {
    const subject = "Support Request: Checkout Issue";
    const body = `Reference: ${activeSession?.externalReference || activeSession?._id}`;
    const mailtoLink = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  };

  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">Need help with your order?</p>
          <Button
            onClick={handleSendEmail}
            variant="clear"
            className="group px-0"
          >
            Contact Support
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CheckoutCompleted() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p className="text-xl">Your checkout session is complete</p>
        </div>

        <div className="space-x-12">
          <Link to="/">
            <Button variant={"clear"} className="px-0">
              Continue shopping
            </Button>
          </Link>

          <Link to="/shop/orders">
            <Button variant={"link"} className="px-0">
              View orders
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function CheckoutMissingPayment() {
  const { activeSession } = useCheckout();

  // const createSupportTicket =
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p>
            This checkout session is missing payment. If you think this is
            incorrect, contact us for support.
          </p>

          <p className="font-medium">{`Reference: ${activeSession.externalReference || activeSession._id}`}</p>
        </div>

        <div className="flex gap-8">
          <Link to="/shop/checkout">
            <Button variant={"clear"} className="group px-0">
              <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
              Return to checkout
            </Button>
          </Link>

          {/* <Link to="/shop/checkout">
            <Button variant={"clear"} className="group px-0 items-center">
              Send message to support
              <ArrowRight className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link> */}
        </div>
      </div>
    </div>
  );
}

export function CheckoutNotComplete() {
  return (
    <div className="container mx-auto max-w-[1024px] h-full flex justify-center">
      <div className="flex flex-col gap-16 mt-24 w-[80%]">
        <div className="space-y-4">
          <p>This checkout session is not complete</p>
        </div>

        <div className="space-x-12">
          <Button
            variant={"clear"}
            className="group px-0"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:-translate-x-0.5" />
            Go back
          </Button>
        </div>
      </div>
    </div>
  );
}
