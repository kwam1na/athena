import { z } from "zod";
import useGetActiveStore, { useGetStores } from "@/hooks/useGetActiveStore";
import { Separator } from "../../components/ui/separator";
import View from "../../components/View";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
// import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2 } from "lucide-react";
// import { deleteStore, getAllStores, updateStore } from "@/api/stores";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../components/ui/form";
import { Input } from "../../components/ui/input";
import { LoadingButton } from "../../components/ui/loading-button";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { deleteAllProducts } from "@/api/product";
import { Store } from "~/types";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { deleteDirectoryInS3 } from "~/src/lib/aws";

const StoreSettings = () => {
  const { activeStore } = useGetActiveStore();

  if (!activeStore) return null;

  return (
    <main className="flex justify-center">
      <div className="flex flex-col w-[50%] gap-8">
        <div className="space-y-4">
          <div>
            <p className="text-xl font-medium">{activeStore.name}</p>
            <p className="text-muted-foreground">Manage your store settings</p>
          </div>
          <Separator />
        </div>

        <div className="space-y-8">
          <GeneralSettings store={activeStore} />
          <Separator />
        </div>

        <DeleteAllProductsInStore store={activeStore} />
        <Separator />

        <DeleteStore store={activeStore} />
      </div>
    </main>
  );
};

const GeneralSettings = ({ store }: { store: Store }) => {
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);

  const navigate = useNavigate();

  const FormSchema = z.object({
    name: z.string().min(1, {
      message: "Please provide a valid name.",
    }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: store.name,
    },
  });

  useEffect(() => {
    form.reset({ name: store.name });
  }, [form, store]);

  const updateStore = useMutation(api.inventory.stores.update);

  const saveStoreChanges = async () => {
    try {
      setIsUpdateMutationPending(true);

      const newStore = await updateStore({
        name: form.getValues().name,
        id: store._id,
      });

      toast("Store updated", {
        icon: <CheckCircle2 className="h-4 w-4" />,
        description: `Store name has been updated`,
      });

      if (newStore) {
        navigate({
          to: "/$orgUrlSlug/settings/stores/$storeUrlSlug",
          params: (prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: newStore.slug,
          }),
        });
      }
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

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
                      Store name
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
              <LoadingButton isLoading={isUpdateMutationPending} type="submit">
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
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const navigate = useNavigate();

  const stores = useGetStores();

  const deleteStore = useMutation(api.inventory.stores.remove);

  const handleDeleteStore = async () => {
    try {
      setIsDeleteMutationPending(true);

      await deleteStore({
        id: store._id,
      });

      await deleteDirectoryInS3(`stores/${store._id}`);

      toast("Store deleted", {
        icon: <CheckCircle2 className="h-4 w-4" />,
        description: `Store name has been updated`,
      });

      navigate({
        to: "/$orgUrlSlug/settings",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
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
        isLoading={isDeleteMutationPending}
        onClick={() => handleDeleteStore()}
      >
        Delete store
      </LoadingButton>
    </div>
  );
};

const DeleteAllProductsInStore = ({ store }: { store: Store }) => {
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const removeAllProductsForStore = useMutation(
    api.inventory.products.removeAllProductsForStore
  );

  const handleDeleteAllProductsInStore = async () => {
    try {
      setIsDeleteMutationPending(true);

      await removeAllProductsForStore({ storeId: store._id });

      await deleteDirectoryInS3(`stores/${store._id}/products`);

      toast("Products deleted", {
        icon: <CheckCircle2 className="h-4 w-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="h-4 w-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <p className="font-medium">Delete all products in store</p>
        <p className="text-muted-foreground">This action cannot be undone.</p>
      </div>

      <LoadingButton
        variant={"destructive"}
        isLoading={isDeleteMutationPending}
        onClick={() => handleDeleteAllProductsInStore()}
      >
        Delete products
      </LoadingButton>
    </div>
  );
};

export default function StoreSettingsView() {
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
      <StoreSettings />
    </View>
  );
}
