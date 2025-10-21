import React, { useEffect, useImperativeHandle, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCheckout } from "@/hooks/useCheckout";
import { Address, CustomerDetails } from "./types";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import { Button } from "../ui/button";
import { ArrowDown } from "lucide-react";
import { motion } from "framer-motion";
import { customerDetailsSchema } from "./schemas/customerDetailsSchema";

const EnteredCustomerDetails = () => {
  const { checkoutState } = useCheckout();

  if (!checkoutState.customerDetails) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="text-sm space-y-2"
    >
      <p>{`${checkoutState.customerDetails?.firstName} ${checkoutState.customerDetails?.lastName}`}</p>
      <p>{checkoutState.customerDetails?.email}</p>
      <p>{checkoutState.customerDetails?.phoneNumber}</p>
    </motion.div>
  );
};

export const CustomerDetailsForm = () => {
  const { checkoutState, actionsState, updateActionsState, updateState } =
    useCheckout();

  const form = useForm({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: checkoutState.customerDetails || {
      firstName: "",
      lastName: "",
      email: "",
      phoneNumber: "",
    },
  });

  const onSubmit = (data: z.infer<typeof customerDetailsSchema>) => {
    updateState({ customerDetails: data });
    updateActionsState({ isEditingCustomerDetails: false });
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full space-y-12"
      >
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
            <p>Contact</p>
            {Boolean(checkoutState.customerDetails) && (
              <Button
                onClick={() => {
                  updateActionsState({
                    isEditingCustomerDetails:
                      !actionsState.isEditingCustomerDetails,
                  });
                }}
                variant={"clear"}
                type="button"
                className="ml-auto"
              >
                <p className="underline">
                  {actionsState.isEditingCustomerDetails
                    ? "Cancel editing"
                    : "Edit"}
                </p>
              </Button>
            )}
          </motion.div>

          {/* Display entered customer details when not editing */}
          {!actionsState.isEditingCustomerDetails &&
            checkoutState.customerDetails && <EnteredCustomerDetails />}

          {/* Show form fields when editing or no customer details exist */}
          {(actionsState.isEditingCustomerDetails ||
            !checkoutState.customerDetails) && (
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
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          First name
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="w-full xl:w-[50%]">
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Last name
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
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
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Email
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="w-full xl:w-[50%]">
                  <FormField
                    control={form.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Phone number
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Show continue button only when editing */}
        {(actionsState.isEditingCustomerDetails ||
          !checkoutState.customerDetails) && (
          <motion.div
            initial={{ opacity: checkoutState.customerDetails ? 1 : 0 }}
            animate={{
              opacity: 1,
              transition: { delay: 0.4, duration: 0.6, ease: "easeOut" },
            }}
            exit={{ opacity: 0 }}
          >
            <LoadingButton className="w-[50%]" isLoading={false} type="submit">
              {actionsState.isEditingCustomerDetails ? "Save" : "Continue"}
            </LoadingButton>
          </motion.div>
        )}
      </form>
    </Form>
  );
};
