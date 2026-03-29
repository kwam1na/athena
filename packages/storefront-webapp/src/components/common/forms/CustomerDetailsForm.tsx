import { useEffect, useImperativeHandle, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { Button } from "@/components/ui/button";

const nameRegex = /^[a-zA-Zà-öø-ÿÀ-ÖØ-ß\-'\.\s]+$/;
const phoneNumberRegex =
  /^(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}$/;

export const customerDetailsSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .regex(nameRegex, "First name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "First name cannot be empty or whitespace"
    ),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .regex(nameRegex, "Last name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "Last name cannot be empty or whitespace"
    ),
  email: z
    .string()
    .email("Invalid email")
    .refine(
      (value) => value.trim().length > 0,
      "Email cannot be empty or whitespace"
    ),
  phoneNumber: z
    .string()
    .min(10, "Invalid phone number")
    .regex(phoneNumberRegex, "Invalid phone number")
    .refine(
      (value) => value.trim().length > 0,
      "Phone number cannot be empty or whitespace"
    ),
});

export const CustomerDetailsForm = ({
  onCancelClick,
  onSubmitClick,
  defaultValues,
}: {
  onCancelClick: () => void;
  onSubmitClick: (data: any) => Promise<void>;
  defaultValues: any;
}) => {
  const form = useForm({
    resolver: zodResolver(customerDetailsSchema),
    defaultValues: defaultValues || {
      firstName: "",
      lastName: "",
      email: "",
      phoneNumber: "",
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (data: z.infer<typeof customerDetailsSchema>) => {
    setIsSubmitting(true);
    try {
      await onSubmitClick(data);
      onCancelClick();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
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
          </motion.div>

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
            <div className="flex flex-col gap-4">
              <div>
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

              <div>
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

            <div className="flex flex-col gap-4">
              <div>
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

              <div>
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
        </div>

        <div className="flex gap-4">
          <LoadingButton
            isLoading={isSubmitting}
            className="w-[50%]"
            type="submit"
          >
            Save
          </LoadingButton>

          <Button
            className="w-[50%]"
            type="button"
            onClick={onCancelClick}
            disabled={isSubmitting}
            variant={"ghost"}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};
