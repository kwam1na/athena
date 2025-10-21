import { motion } from "framer-motion";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { UseFormReturn } from "react-hook-form";
import { useCheckout } from "@/hooks/useCheckout";
import {
  Address,
  BillingAddress,
  CustomerDetails,
  DeliveryMethod,
} from "./types";

export interface CheckoutFormSectionProps {
  form: UseFormReturn<
    {
      deliveryInstructions: string;
      deliveryMethod: DeliveryMethod | null;
      customerDetails: CustomerDetails;
      deliveryDetails: Address;
      // billingDetails: BillingAddress;
    },
    any,
    undefined
  >;
}

export const CustomerInfoSection = ({ form }: CheckoutFormSectionProps) => {
  const { updateState, checkoutState } = useCheckout();

  return (
    <div className="flex flex-col gap-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, ease: "easeOut" },
        }}
        exit={{
          opacity: 0,
          transition: { duration: 0.3, ease: "easeOut" },
        }}
        className="flex items-center"
      >
        <p className="text-xs text-muted-foreground">Contact details</p>
      </motion.div>

      {/* Display entered customer details when not editing */}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          y: 0,
          transition: { duration: 0.3, ease: "easeOut" },
        }}
        exit={{
          opacity: 0,
          transition: { duration: 0.3, ease: "easeOut" },
        }}
        className="space-y-4"
      >
        <div className="flex flex-col xl:flex-row gap-4">
          <div className="w-full xl:w-[50%]">
            <FormField
              control={form.control}
              name="customerDetails.firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground text-xs">
                    First name
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => {
                        updateState({
                          customerDetails: {
                            ...checkoutState.customerDetails,
                            firstName: e.target.value,
                          } as CustomerDetails,
                        });
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </div>

          <div className="w-full xl:w-[50%]">
            <FormField
              control={form.control}
              name="customerDetails.lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground text-xs">
                    Last name
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => {
                        updateState({
                          customerDetails: {
                            ...checkoutState.customerDetails,
                            lastName: e.target.value,
                          } as CustomerDetails,
                        });
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex flex-col xl:flex-row gap-4">
          <div className="w-full xl:w-[50%]">
            <FormField
              control={form.control}
              name="customerDetails.email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground text-xs">
                    Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => {
                        updateState({
                          customerDetails: {
                            ...checkoutState.customerDetails,
                            email: e.target.value,
                          } as CustomerDetails,
                        });
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </div>

          <div className="w-full xl:w-[50%]">
            <FormField
              control={form.control}
              name="customerDetails.phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground text-xs">
                    Phone number
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      onChange={(e) => {
                        updateState({
                          customerDetails: {
                            ...checkoutState.customerDetails,
                            phoneNumber: e.target.value,
                          } as CustomerDetails,
                        });
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
};
