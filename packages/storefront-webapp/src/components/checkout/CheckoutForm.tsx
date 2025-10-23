import { motion } from "framer-motion";
import { Form } from "../ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCheckout } from "@/hooks/useCheckout";
import { CustomerInfoSection } from "./CustomerInfoSection";
import { checkoutFormSchema } from "./schemas/checkoutFormSchema";
import { PickupOptions } from "./DeliveryDetails/PickupOptions";
import { StoreSelector } from "./DeliveryDetails/DeliveryOptionsSelector";
import { PaymentSection } from "./PaymentSection";
import { DeliveryDetailsSection } from "./DeliveryDetailsSection";
import { DeliveryOptions } from "./DeliveryDetails/DeliverySection";
import { InfoIcon } from "lucide-react";

export const CheckoutForm = () => {
  const { checkoutState } = useCheckout();

  const defaultValues = {
    deliveryInstructions: checkoutState.deliveryInstructions,
    deliveryMethod: checkoutState.deliveryMethod,
    customerDetails: checkoutState.customerDetails || {
      firstName: "",
      lastName: "",
      email: "",
      phoneNumber: "",
    },
    deliveryDetails: checkoutState.deliveryDetails || {
      address: "",
      city: "",
      region: "",
      country: "",
      zip: "",
      state: "",
      street: "",
      houseNumber: "",
      neighborhood: "",
      landmark: "",
    },
    // billingDetails: checkoutState.billingDetails || {
    //   address: "",
    //   city: "",
    //   state: "",
    //   country: "",
    //   zip: "",
    // },
  };

  const form = useForm({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: defaultValues || {
      deliveryMethod: null,
      deliveryInstructions: "",
      customerDetails: {
        firstName: "",
        lastName: "",
        email: "",
        phoneNumber: "",
      },
      deliveryDetails: {
        address: "",
        city: "",
        region: "",
        country: "",
        zip: "",
        state: "",
        street: "",
        houseNumber: "",
        neighborhood: "",
        landmark: "",
      },
      // billingDetails: {
      //   address: "",
      //   city: "",
      //   state: "",
      //   country: "",
      //   zip: "",
      // },
    },
  });

  const readyText = checkoutState.isDeliveryOrder
    ? "Orders typically arrive within 1-2 business days"
    : "Orders are typically ready for pickup within 1-2 business days";

  const onSubmit = (data: any) => {};

  return (
    <Form {...form}>
      <form className="w-full space-y-8" onSubmit={form.handleSubmit(onSubmit)}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4 },
          }}
          className="space-y-16"
        >
          <PickupOptions />

          <div className="space-y-8">
            {checkoutState.isDeliveryOrder && <DeliveryOptions form={form} />}

            {checkoutState.isPickupOrder && <StoreSelector />}

            <div className="flex text-muted-foreground">
              <p className="text-xs">{readyText}</p>
            </div>
          </div>

          {checkoutState.isDeliveryOrder && (
            <DeliveryDetailsSection form={form} />
          )}

          <CustomerInfoSection form={form} />

          <PaymentSection form={form} />
        </motion.div>
      </form>
    </Form>
  );
};
