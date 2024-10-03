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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { Ban } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useOrganizationModal } from "@/hooks/useOrganizationModal";
import { createOrganization } from "@/api/organization";

const formSchema = z.object({
  organizationName: z.string().min(1),
});

export const OrganizationModal = () => {
  const organizationModal = useOrganizationModal();

  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      organizationName: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) =>
      saveOrganization(values),
    onSuccess: (organization) => {
      if (!organization) {
        toast("Something went wrong", {
          description: "Missing organization information",
          icon: <Ban className="w-4 h-4" />,
        });

        return;
      }

      toast("Organization created", {
        icon: <CheckCircledIcon className="w-4 h-4" />,
        description: `${organization.organizationName} added to your organizations`,
      });
      queryClient.invalidateQueries({
        queryKey: ["organizations"],
      });
      form.reset();

      navigate({
        to: "/organization/$orgUrlSlug/store",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: organization.organizationUrlSlug,
        }),
      });

      organizationModal.onClose();
    },
    onError: (e) => {
      toast("Something went wrong", {
        description: e.message,
        icon: <Ban className="w-4 h-4" />,
      });
    },
  });

  const saveOrganization = async (values: z.infer<typeof formSchema>) => {
    const data = {
      organizationName: values.organizationName,
    };

    return await createOrganization(data);
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    createMutation.mutate(values);
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
                      name="organizationName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input
                              disabled={createMutation.isPending}
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
                    disabled={createMutation.isPending}
                    variant="outline"
                    onClick={organizationModal.onClose}
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
