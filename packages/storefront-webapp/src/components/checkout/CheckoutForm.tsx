import { motion } from "framer-motion";
import { Form } from "../ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCheckout } from "./CheckoutProvider";
import { CustomerInfoSection } from "./CustomerInfoSection";
import { checkoutFormSchema } from "./schemas/checkoutFormSchema";
import { PickupOptions } from "./DeliveryDetails/PickupOptions";
import { StoreSelector } from "./DeliveryDetails/DeliveryOptionsSelector";
import { PaymentSection } from "./PaymentSection";
import { DeliveryDetailsSection } from "./DeliveryDetailsSection";
import { DeliveryOptions } from "./DeliveryDetails/DeliverySection";

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

  const onSubmit = (data: any) => {};

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4 },
          }}
          className="space-y-16"
        >
          <PickupOptions />

          {checkoutState.isDeliveryOrder && <DeliveryOptions form={form} />}

          {checkoutState.isPickupOrder && <StoreSelector />}

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
