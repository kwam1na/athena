import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useStoreModal } from "@/hooks/use-store-modal";
import { toast } from "sonner";
import { currencies, OG_ORGANIZTION_ID } from "@/lib/constants";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { Ban } from "lucide-react";
import { createStore } from "@/api/stores";
import { useNavigate } from "@tanstack/react-router";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";

const formSchema = z.object({
  name: z.string().min(1),
  currency: z.string().min(1),
});

export const StoreModal = () => {
  const storeModal = useStoreModal();

  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      currency: "",
    },
  });

  const { activeOrganization } = useGetActiveOrganization();

  const createMutation = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) => saveStore(values),
    onSuccess: (store) => {
      if (!store) {
        toast("Something went wrong", {
          description: "Missing store information",
          icon: <Ban className="w-4 h-4" />,
        });

        return;
      }

      toast(`${store.name} created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
      queryClient.invalidateQueries({
        queryKey: ["stores", activeOrganization?.id],
      });
      form.reset();

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: store.slug,
        }),
      });

      storeModal.onClose();
    },
    onError: (e) => {
      toast("Something went wrong", {
        description: e.message,
        icon: <Ban className="w-4 h-4" />,
      });
    },
  });

  const saveStore = async (values: z.infer<typeof formSchema>) => {
    if (!activeOrganization) return;

    const data = {
      ...values,
      name: values.name,
      createdByUserId: 1,
      organizationId: activeOrganization.id,
    };

    return await createStore(activeOrganization.id, data);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    createMutation.mutate(values);
  };

  return (
    <Modal
      title="Create store"
      description=""
      isOpen={storeModal.isOpen}
      onClose={storeModal.onClose}
    >
      <div>
        <div className="space-y-4 py-2 pb-4">
          <div className="space-y-2">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)}>
                <div className="flex w-full gap-8">
                  <div className="w-[60%]">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              disabled={createMutation.isPending}
                              placeholder="Acme Inc."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="w-[60%]">
                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Currency</FormLabel>
                          <Select
                            disabled={createMutation.isPending}
                            onValueChange={field.onChange}
                            value={field.value}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  defaultValue={field.value}
                                  placeholder="Select a currency"
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {currencies.map((currency) => (
                                <SelectItem
                                  key={currency.value}
                                  value={currency.value}
                                >
                                  {currency.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="pt-6 space-x-2 flex items-center justify-end w-full">
                  <Button
                    disabled={createMutation.isPending}
                    variant="outline"
                    onClick={storeModal.onClose}
                  >
                    Cancel
                  </Button>
                  <LoadingButton
                    isLoading={createMutation.isPending}
                    disabled={createMutation.isPending}
                    type="submit"
                  >
                    Continue
                  </LoadingButton>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </div>
    </Modal>
  );
};
