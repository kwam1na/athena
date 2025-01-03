import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
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
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Separator } from "@/components/ui/separator";
import { OrganizationResponse } from "@/lib/schemas/organization";
import View from "@/components/View";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { Store } from "~/types";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

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
  const navigate = useNavigate();
  const [isUpdatingOrganization, setIsUpdatingOrganization] = useState(false);

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

    setIsUpdatingOrganization(true);

    try {
      const updated = await updateOrganization(organization.id, data);
      toast.success("Organization updated");
      navigate({
        to: "/$orgUrlSlug/settings/organization",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: updated.slug,
        }),
      });
    } catch (e) {
      toast.error("Something went wrong", {
        description: (e as Error).message,
      });
    } finally {
      setIsUpdatingOrganization(false);
    }
  };

  const updateOrganization = useMutation(api.inventory.organizations.update);

  async function onSubmit() {
    await saveStoreChanges();
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
              <LoadingButton isLoading={isUpdatingOrganization} type="submit">
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
  const [isDeletingStore, setIsDeletingStore] = useState(false);

  const stores = useQuery(api.inventory.stores.getAll, {
    organizationId: store.organizationId,
  });

  const deleteStore = useMutation(api.inventory.stores.remove);

  const handleDeleteStore = async () => {
    setIsDeletingStore(true);
    try {
      await deleteStore({
        organizationId: store.organizationId,
        storeId: store._id,
      });

      toast.success("Store deleted");
    } catch (e) {
      toast.error("Something went wrong");
    } finally {
      setIsDeletingStore(false);
    }
  };

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
        isLoading={isDeletingStore}
        onClick={handleDeleteStore}
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
