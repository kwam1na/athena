import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { useEffect, useState } from "react";
import { LoadingButton } from "../ui/loading-button";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { toast } from "sonner";
import {
  createSubcategory,
  deleteSubategory,
  getAllSubcategories,
  updateSubcategory,
} from "@/api/subcategory";
import { Ban } from "lucide-react";
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  updateCategory,
} from "@/api/category";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { CategoryResponse } from "@/lib/schemas/category";
import { Category, Store } from "@athena/db";

export type CategoryManageOption = "category" | "subcategory";

function Sidebar({
  selected,
  setSelected,
}: {
  selected: CategoryManageOption;
  setSelected: (option: CategoryManageOption) => void;
}) {
  return (
    <div className="flex gap-4">
      <p
        className={`text-left cursor-pointer ${selected == "category" ? "font-medium" : "text-muted-foreground"}`}
        onClick={() => setSelected("category")}
      >
        Categories
      </p>
      <p
        className={`text-left cursor-pointer ${selected == "subcategory" ? "font-medium" : "text-muted-foreground"}`}
        onClick={() => setSelected("subcategory")}
      >
        Subategories
      </p>
    </div>
  );
}

function CategoryManager() {
  const queryClient = useQueryClient();

  const { activeStore } = useGetActiveStore();

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", activeStore?.id],
    queryFn: () =>
      getAllCategories({
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
      }),
    enabled: Boolean(activeStore),
  });

  const [name, setName] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryIdToRename, setCategoryIdToRename] = useState<number | null>(
    null
  );
  const [updatedName, setUpdatedName] = useState<string | null>(null);

  const categories =
    categoriesData?.map((category: Category) => ({
      name: category.name,
      id: category.id.toString(),
    })) || [];

  useEffect(() => {
    const idToUse = categoryId || categoryIdToRename;

    const name = categories.find(({ id }) => id == idToUse?.toString())?.name;

    if (name) setSelectedCategory(name);
  }, [categoryId, categoryIdToRename]);

  const save = async () => {
    if (!name || !activeStore) {
      console.log("returning because null...");
      throw new Error("Missing data to save category");
    }

    await createCategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      data: {
        name,
        storeId: activeStore.id,
        createdByUserId: 1,
        organizationId: activeStore.organizationId,
      },
    });
  };

  const update = async () => {
    if (!categoryIdToRename || !updatedName || !activeStore) {
      throw new Error("Missing data to update category");
    }

    await updateCategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      categoryId: categoryIdToRename,
      data: {
        name: updatedName,
        storeId: activeStore?.id,
      },
    });
  };

  const removeCategory = async () => {
    if (!categoryId || !activeStore) {
      throw new Error("Missing data to remove category");
    }

    await deleteCategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      categoryId,
    });
  };

  const createMutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast(`Category '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["categories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: update,
    onSuccess: () => {
      toast(`Category '${selectedCategory}' updated`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["categories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: removeCategory,
    onSuccess: () => {
      toast(`Category '${selectedCategory}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["categories", activeStore?.id],
      });

      queryClient.invalidateQueries({
        queryKey: ["subcategories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Add category</p>
        <Separator className="mt-2" />

        <div className="grid gap-4 py-4">
          <div className="flex items-center gap-4">
            <Label className="text-muted-foreground w-[30%]" htmlFor="name">
              Name
            </Label>
            <div className="flex gap-4 w-full">
              <Input id="name" onChange={(e) => setName(e.target.value)} />
              <LoadingButton
                className="ml-auto"
                variant={"outline"}
                disabled={!name}
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Add
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Update category</p>
        <Separator className="mt-2" />

        <div className="grid gap-4 py-4">
          <div className="flex gap-4 items-center">
            <Label className="text-muted-foreground w-[30%]" htmlFor="category">
              Category
            </Label>

            <div className="flex gap-4 w-full">
              <Select
                onValueChange={(value) =>
                  setCategoryIdToRename(parseInt(value))
                }
              >
                <SelectTrigger id="category" aria-label="Select category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => {
                    return (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex w-full items-center gap-4">
            <Label className="text-muted-foreground w-[30%]" htmlFor="name">
              Updated name
            </Label>

            <div className="flex gap-4 w-full">
              <Input
                id="name"
                onChange={(e) => setUpdatedName(e.target.value)}
              />
              <LoadingButton
                disabled={!categoryIdToRename || !updatedName}
                isLoading={updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
                variant={"outline"}
              >
                Update
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Delete category</p>
        <Separator className="mt-2" />

        <div className="flex gap-4 items-center py-4">
          <Label className="text-muted-foreground w-[30%]" htmlFor="category">
            Category
          </Label>

          <div className="flex gap-4 w-full">
            <Select onValueChange={(value) => setCategoryId(parseInt(value))}>
              <SelectTrigger id="category" aria-label="Select category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => {
                  return (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <LoadingButton
              variant={"destructive"}
              disabled={!categoryId}
              isLoading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubcategoryManager() {
  const queryClient = useQueryClient();

  const { activeStore } = useGetActiveStore();

  const { data: subcategoriesData } = useQuery({
    queryKey: ["subcategories", activeStore?.id],
    queryFn: () =>
      getAllSubcategories({
        organizationId: activeStore!.organizationId,
        storeId: activeStore!.id,
      }),
    enabled: Boolean(activeStore),
  });

  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(
    null
  );
  const [name, setName] = useState<string | null>(null);

  const [subcategoryIdToRename, setSubcategoryIdToRename] = useState<
    number | null
  >(null);
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  const [updatedName, setUpdatedName] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);

  const subcategories =
    subcategoriesData?.map((subcategory) => ({
      name: subcategory.name,
      id: subcategory.id,
    })) || [];

  useEffect(() => {
    const idToUse = subcategoryId || subcategoryIdToRename;

    const name = subcategories.find(({ id }) => id == idToUse)?.name;

    if (name) setSelectedSubcategory(name);
  }, [subcategoryId, subcategoryIdToRename]);

  const categoriesData = queryClient.getQueryData<Category[]>([
    "categories",
    activeStore?.id,
  ]);

  const categories =
    categoriesData?.map((category) => ({
      name: category.name,
      id: category.id.toString(),
    })) || [];

  const save = async () => {
    if (!name || !categoryId || !activeStore) {
      throw new Error("Missing data to save subcategory");
    }

    await createSubcategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      data: {
        name,
        storeId: activeStore.id,
        categoryId,
        organizationId: activeStore.organizationId,
        createdByUserId: 1,
      },
    });
  };

  const update = async () => {
    if (!subcategoryIdToRename || !activeStore) {
      throw new Error("Missing data to update subcategory");
    }

    await updateSubcategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      subcategoryId: subcategoryIdToRename,
      data: {
        name: updatedName ?? undefined,
        storeId: activeStore.id,
        categoryId: newCategoryId ?? undefined,
      },
    });
  };

  const removeSubcategory = async () => {
    if (!subcategoryId || !activeStore) {
      throw new Error("Missing data to delete subcategory");
    }

    await deleteSubategory({
      organizationId: activeStore.organizationId,
      storeId: activeStore.id,
      subcategoryId,
    });
  };

  const createMutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      toast(`Subcategory '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["subcategories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: update,
    onSuccess: () => {
      toast(`Subcategory '${selectedSubcategory}' updated`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["subcategories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: removeSubcategory,
    onSuccess: () => {
      toast(`Subcategory '${selectedSubcategory}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      queryClient.invalidateQueries({
        queryKey: ["subcategories", activeStore?.id],
      });
    },
    onError: (e) => {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    },
  });

  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Add subcategory</p>
        <Separator className="mt-2" />

        <div className="grid gap-4 py-4">
          <div className="flex items-center gap-4">
            <Label className="text-muted-foreground w-[30%]" htmlFor="name">
              Name
            </Label>
            <Input id="name" onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex gap-4 items-center">
            <Label className="text-muted-foreground w-[30%]" htmlFor="category">
              Category
            </Label>

            <div className="flex w-full gap-4 items-center">
              <Select onValueChange={(value) => setCategoryId(parseInt(value))}>
                <SelectTrigger id="category" aria-label="Select category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => {
                    return (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <LoadingButton
                className="ml-auto"
                variant={"outline"}
                disabled={!name || !categoryId}
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                Add
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Update subcategory</p>
        <Separator className="mt-2" />

        <div className="grid gap-4 py-4">
          <div className="flex gap-4 items-center">
            <Label className="text-muted-foreground w-[30%]" htmlFor="category">
              Subcategory
            </Label>

            <div className="flex gap-4 w-full">
              <Select
                onValueChange={(value) =>
                  setSubcategoryIdToRename(parseInt(value))
                }
              >
                <SelectTrigger id="subcategory" aria-label="Select subcategory">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {subcategories.map((subcategory) => {
                    return (
                      <SelectItem
                        key={subcategory.id}
                        value={subcategory.id.toString()}
                      >
                        {subcategory.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Label className="text-muted-foreground w-[30%]" htmlFor="name">
              Updated name
            </Label>
            <Input
              id="name"
              className="col-span-3"
              onChange={(e) => setUpdatedName(e.target.value)}
            />
          </div>

          <div className="flex gap-4 items-center">
            <Label className="text-muted-foreground w-[30%]" htmlFor="category">
              Category
            </Label>

            <div className="flex gap-4 w-full">
              <Select
                onValueChange={(value) => setNewCategoryId(parseInt(value))}
              >
                <SelectTrigger id="subcategory" aria-label="Select subcategory">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => {
                    return (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <LoadingButton
                className="ml-auto"
                disabled={!subcategoryIdToRename || !newCategoryId}
                isLoading={updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
                variant={"outline"}
              >
                Update
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Delete subcategory</p>
        <Separator className="mt-2" />

        <div className="flex gap-4 items-center py-4">
          <Label className="text-muted-foreground w-[30%]" htmlFor="category">
            Subcategory
          </Label>

          <div className="flex gap-4 w-full">
            <Select
              onValueChange={(value) => setSubcategoryId(parseInt(value))}
            >
              <SelectTrigger id="subcategory" aria-label="Select subcategory">
                <SelectValue placeholder="Select subcategory" />
              </SelectTrigger>
              <SelectContent>
                {subcategories.map((subcategory) => {
                  return (
                    <SelectItem
                      key={subcategory.id}
                      value={subcategory.id.toString()}
                    >
                      {subcategory.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <LoadingButton
              variant={"destructive"}
              disabled={!subcategoryId}
              isLoading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CategorySubcategoryManager({
  initialSelectedOption = "category",
}: {
  initialSelectedOption?: CategoryManageOption;
}) {
  const [selected, setSelected] = useState<CategoryManageOption>(
    initialSelectedOption
  );

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="w-[30%]">
        <Sidebar selected={selected} setSelected={setSelected} />
      </div>

      {selected == "category" && <CategoryManager />}
      {selected == "subcategory" && <SubcategoryManager />}
    </div>
  );
}
