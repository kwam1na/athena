import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2 } from "lucide-react";
import { deleteStore, getAllStores } from "@/api/stores";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { StoreResponse } from "@/lib/schemas/store";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Separator } from "@/components/ui/separator";
import { updateOrganization } from "@/api/organization";
import { OrganizationResponse } from "@/lib/schemas/organization";
import View from "@/components/View";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { Store } from "@athena/db";

const OrganizationSettings = () => {
  const { activeOrganization } = useGetActiveOrganization();

  if (!activeOrganization) return null;

  return (
    <main className="flex justify-center">
      <div className="flex flex-col w-[50%] gap-8">
        <div className="space-y-4">
          <div>
            <p className="text-xl font-medium">Organization</p>
            <p className="text-muted-foreground">
              Manage your organization settings
            </p>
          </div>
          <Separator />
        </div>

        <div className="space-y-8">
          <GeneralSettings organization={activeOrganization} />
        </div>
      </div>
    </main>
  );
};

const GeneralSettings = ({
  organization,
}: {
  organization: OrganizationResponse;
}) => {
  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const FormSchema = z.object({
    name: z.string().min(1, {
      message: "Please provide a valid name.",
    }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: organization.name,
    },
  });

  useEffect(() => {
    form.reset({ name: organization.name });
  }, [form, organization]);

  const saveStoreChanges = async () => {
    const data = {
      name: form.getValues().name,
    };
    return await updateOrganization(organization.id, data);
  };

  const mutation = useMutation({
    mutationFn: saveStoreChanges,
    onSuccess: (newOrganization) => {
      toast("Organization updated", {
        icon: <CheckCircle2 className="h-4 w-4" />,
        description: `Organization name has been updated`,
      });
      queryClient.invalidateQueries({
        queryKey: ["organizations"],
      });

      navigate({
        to: "/$orgUrlSlug/settings/organization",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: newOrganization.slug,
        }),
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
        description: e.message,
      });
    },
  });

  function onSubmit() {
    mutation.mutate();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-4">
        <p className="font-medium">General</p>
        <div className="flex flex-col w-full">
          <div className="flex gap-4">
            <div className="min-w-[300px] ">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground">
                      Organization name
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div
              className={`h-full flex self-end transition-opacity duration-300 ${form.formState.isDirty ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            >
              <LoadingButton isLoading={mutation.isPending} type="submit">
                Save
              </LoadingButton>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
};

const DeleteStore = ({ store }: { store: Store }) => {
  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const { data: stores } = useQuery({
    queryKey: ["stores", store.organizationId],
    queryFn: () => getAllStores(store.organizationId),
  });

  const handleDeleteStore = async () => {
    return await deleteStore({
      organizationId: store.organizationId,
      storeId: store.id,
    });
  };

  const deleteMutation = useMutation({
    mutationFn: handleDeleteStore,
    onSuccess: () => {
      toast("Store deleted", {
        icon: <CheckCircle2 className="h-4 w-4" />,
      });
      queryClient.invalidateQueries({
        queryKey: ["stores", store.organizationId],
      });

      navigate({
        to: "/$orgUrlSlug/settings",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    },
    onError: () => {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <p className="font-medium">Delete store</p>
        {stores && stores.length > 1 && (
          <p className="text-muted-foreground">This action cannot be undone.</p>
        )}
        {stores && stores.length == 1 && (
          <p className="text-muted-foreground">
            This is your organization's only store. It cannot be deleted.
          </p>
        )}
      </div>

      <LoadingButton
        variant={"destructive"}
        disabled={stores && stores.length == 1}
        isLoading={deleteMutation.isPending}
        onClick={() => deleteMutation.mutate()}
      >
        Delete store
      </LoadingButton>
    </div>
  );
};

export default function OrganizationSettingsView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  return (
    <View
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <OrganizationSettings />
    </View>
  );
}
