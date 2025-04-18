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
import { CheckCircledIcon, TrashIcon } from "@radix-ui/react-icons";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Category } from "~/types";
import { Id } from "~/convex/_generated/dataModel";
import { toSlug } from "~/src/lib/utils";
import { Checkbox } from "../ui/checkbox";

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
  const { activeStore } = useGetActiveStore();

  const categoriesData = useQuery(
    api.inventory.categories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const [name, setName] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<Id<"category"> | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [categoryIdToRename, setCategoryIdToRename] =
    useState<Id<"category"> | null>(null);

  const [updatedName, setUpdatedName] = useState<string | null>(null);

  const [isCreateMutationPending, setIsCreateMutationPending] = useState(false);
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const categories =
    categoriesData?.map((category: Category) => ({
      name: category.name,
      id: category._id,
    })) || [];

  useEffect(() => {
    const idToUse = categoryId || categoryIdToRename;

    const name = categories.find(({ id }) => id == idToUse?.toString())?.name;

    if (name) setSelectedCategory(name);
  }, [categoryId, categoryIdToRename]);

  const createCategory = useMutation(api.inventory.categories.create);

  const updateCategory = useMutation(api.inventory.categories.update);

  const deleteCategory = useMutation(api.inventory.categories.remove);

  const save = async () => {
    if (!name || !activeStore) {
      throw new Error("Missing data to save category");
    }

    try {
      setIsCreateMutationPending(true);
      await createCategory({
        name,
        slug: toSlug(name),
        storeId: activeStore._id,
      });

      toast(`Category '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsCreateMutationPending(false);
    }
  };

  const update = async () => {
    if (!categoryIdToRename || !updatedName || !activeStore) {
      throw new Error("Missing data to update category");
    }

    try {
      setIsUpdateMutationPending(true);
      await updateCategory({
        id: categoryIdToRename,
        name: updatedName,
        slug: toSlug(updatedName),
      });

      toast(`Category updated to '${updatedName}'`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

  const removeCategory = async () => {
    if (!categoryId || !activeStore) {
      throw new Error("Missing data to remove category");
    }

    try {
      setIsDeleteMutationPending(true);
      await deleteCategory({ id: categoryId });

      toast(`Category '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
    }
  };

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
                isLoading={isCreateMutationPending}
                onClick={() => save()}
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
                  setCategoryIdToRename(value as Id<"category">)
                }
              >
                <SelectTrigger id="category" aria-label="Select category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category: any) => {
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
                isLoading={isUpdateMutationPending}
                onClick={() => update()}
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
            <Select
              onValueChange={(value) => setCategoryId(value as Id<"category">)}
            >
              <SelectTrigger id="category" aria-label="Select category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category: any) => {
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
              isLoading={isDeleteMutationPending}
              onClick={() => removeCategory()}
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
  const { activeStore } = useGetActiveStore();

  const categoriesData = useQuery(
    api.inventory.categories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const subcategoriesData = useQuery(
    api.inventory.subcategories.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(
    null
  );
  const [name, setName] = useState<string | null>(null);

  const [subcategoryIdToRename, setSubcategoryIdToRename] =
    useState<Id<"subcategory"> | null>(null);

  const [newCategoryId, setNewCategoryId] = useState<Id<"category"> | null>(
    null
  );
  const [updatedName, setUpdatedName] = useState<string | null>(null);

  const [categoryId, setCategoryId] = useState<Id<"category"> | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<Id<"subcategory"> | null>(
    null
  );

  const [isCreateMutationPending, setIsCreateMutationPending] = useState(false);
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const [lockCategory, setLockCategory] = useState(false);

  const subcategories =
    subcategoriesData
      ?.map((subcategory: any) => ({
        name: subcategory.name,
        id: subcategory._id,
        categoryId: subcategory.categoryId,
      }))
      .filter((s) => s.categoryId == newCategoryId || !lockCategory)
      .sort((a, b) => a.name.localeCompare(b.name)) || [];

  const subcategoriesFull =
    subcategoriesData
      ?.map((subcategory: any) => ({
        name: subcategory.name,
        id: subcategory._id,
        categoryId: subcategory.categoryId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) || [];

  const categories =
    categoriesData
      ?.map((category: any) => ({
        name: category.name,
        id: category._id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) || [];

  useEffect(() => {
    const idToUse = subcategoryId || subcategoryIdToRename;

    const name = subcategories.find(({ id }) => id == idToUse)?.name;

    if (name) setSelectedSubcategory(name);
  }, [subcategoryId, subcategoryIdToRename]);

  const createSubcategory = useMutation(api.inventory.subcategories.create);

  const updateSubcategory = useMutation(api.inventory.subcategories.update);

  const deleteSubcategory = useMutation(api.inventory.subcategories.remove);

  const selectedSubcategoryToDelete: string = subcategoriesFull.find(
    (s) => s.id === subcategoryId
  )?.name;

  const selectedSubcategoryToRename: string = subcategories.find(
    (s) => s.id === subcategoryIdToRename
  )?.name;

  const save = async () => {
    if (!name || !activeStore || !categoryId) {
      console.log("returning because null...");
      throw new Error("Missing data to save subcategory");
    }

    try {
      setIsCreateMutationPending(true);
      await createSubcategory({
        name,
        slug: toSlug(name),
        storeId: activeStore._id,
        categoryId,
      });

      toast(`Category '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsCreateMutationPending(false);
    }
  };

  const update = async () => {
    if (!subcategoryIdToRename || !activeStore) {
      toast("Missing data to update subcategory", {
        icon: <Ban className="w-4 h-4" />,
      });
      return;
    }

    try {
      setIsUpdateMutationPending(true);
      await updateSubcategory({
        id: subcategoryIdToRename,
        name: updatedName ? updatedName : undefined,
        categoryId: newCategoryId ? newCategoryId : undefined,
      });

      toast(`Subcategory updated`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

  const removeSubcategory = async () => {
    if (!subcategoryId || !activeStore) {
      throw new Error("Missing data to remove subcategory");
    }

    try {
      setIsDeleteMutationPending(true);
      await deleteSubcategory({ id: subcategoryId });

      toast(`Subcategory '${name}' created`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
    }
  };

  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <p className="text-sm">Add subcategory</p>
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
              <Select
                onValueChange={(value) =>
                  setCategoryId(value as Id<"category">)
                }
              >
                <SelectTrigger id="category" aria-label="Select category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category: any) => {
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
                isLoading={isCreateMutationPending}
                onClick={() => save()}
              >
                Add
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex w-full">
          <p className="text-sm">Update subcategory</p>

          <div className="ml-auto flex items-center gap-2">
            <Checkbox
              checked={lockCategory}
              onCheckedChange={(e) => {
                setSubcategoryIdToRename(null);
                setLockCategory(e as boolean);
              }}
              className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
            />
            <label htmlFor="same-as-delivery" className="text-sm">
              Lock category to subcategory
            </label>
          </div>
        </div>
        <Separator className="mt-2" />

        <div className="grid grid-cols-2 gap-4">
          <Select
            onValueChange={(value) => setNewCategoryId(value as Id<"category">)}
          >
            <SelectTrigger id="subcategory" aria-label="Select subcategory">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category: any) => {
                return (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              setSubcategoryIdToRename(value as Id<"subcategory">)
            }
          >
            <SelectTrigger id="subcategory" aria-label="Select subcategory">
              <SelectValue placeholder="Select subcategory" />
            </SelectTrigger>
            <SelectContent>
              {subcategories.map((subcategory: any) => {
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

        <div className="grid grid-cols-1 gap-4 py-4">
          <Input
            id="name"
            placeholder={`Rename ${selectedSubcategoryToRename ?? "subcategory"}`}
            onChange={(e) => setUpdatedName(e.target.value.trim())}
          />

          <div className="flex gap-4">
            <LoadingButton
              disabled={!subcategoryIdToRename}
              isLoading={isUpdateMutationPending}
              onClick={() => update()}
              variant={"outline"}
            >
              {updatedName
                ? "Rename subcategory"
                : "Update category <-> subcategory link"}
            </LoadingButton>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm">Delete subcategory</p>
        <Separator className="mt-2" />

        <div className="flex gap-4 items-center py-4">
          <div className="grid grid-cols-1 gap-8">
            <Select
              onValueChange={(value) =>
                setSubcategoryId(value as Id<"subcategory">)
              }
            >
              <SelectTrigger id="subcategory" aria-label="Select subcategory">
                <SelectValue placeholder="Select subcategory" />
              </SelectTrigger>
              <SelectContent>
                {subcategoriesFull.map((subcategory: any) => {
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

            <div>
              <LoadingButton
                variant={"destructive"}
                disabled={!subcategoryId}
                isLoading={isDeleteMutationPending}
                onClick={() => removeSubcategory()}
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                {`Delete ${selectedSubcategoryToDelete ?? ""}`}
              </LoadingButton>
            </div>
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
