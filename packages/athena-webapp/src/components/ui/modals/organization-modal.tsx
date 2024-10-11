import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
// import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { Ban } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useOrganizationModal } from "@/hooks/useOrganizationModal";
import { createOrganization } from "@/api/organization";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useGetAuthedUser } from "~/src/hooks/useGetAuthedUser";
import { useState } from "react";
import { toSlug } from "~/src/lib/utils";

const formSchema = z.object({
  name: z.string().min(1),
});

export const OrganizationModal = () => {
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);

  const organizationModal = useOrganizationModal();

  const user = useGetAuthedUser();

  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  const createOrganization = useMutation(api.inventory.organizations.create);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user?._id) {
      return;
    }

    setIsCreatingOrganization(true);
    try {
      await createOrganization({
        ...values,
        createdByUserId: user._id,
        slug: toSlug(values.name),
      });

      toast("Organization created", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
        description: `${values.name} added to your organizations`,
      });

      organizationModal.onClose();
    } catch (e) {
      toast("Something went wrong", {
        description: (e as Error).message,
        icon: <Ban className="w-4 h-4" />,
      });
    } finally {
      setIsCreatingOrganization(false);
    }
  };

  return (
    <Modal
      title="Create organization"
      description=""
      isOpen={organizationModal.isOpen}
      onClose={organizationModal.onClose}
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
                              disabled={isCreatingOrganization}
                              placeholder="Acme Org."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="pt-6 space-x-2 flex items-center justify-end w-full">
                  <Button
                    disabled={isCreatingOrganization}
                    variant="outline"
                    onClick={organizationModal.onClose}
                  >
                    Cancel
                  </Button>
                  <LoadingButton
                    isLoading={isCreatingOrganization}
                    disabled={isCreatingOrganization}
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
