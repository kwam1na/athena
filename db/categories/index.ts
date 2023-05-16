import { supabase } from "@/lib/supabase";
import { Category } from "@/lib/types";

const TABLE_NAME = "categories";

export const getCategories = async (): Promise<Category[]> => {
  const { data, error } = await supabase.from(TABLE_NAME).select("*");
  if (error) {
    throw new Error(`Error fetching ${TABLE_NAME}`);
  }

  return data as Category[];
};

export const getCategoryById = async (id: string): Promise<Category | null> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Error fetching item with id ${id}`);
  }

  return data as Category;
};

export const createCategory = async (
  item: Partial<Category>
): Promise<Category> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(item)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Category;
};

export const updateCategory = async (
  id: string,
  item: Partial<Category>
): Promise<Category> => {
  item.date_updated = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(item)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Category;
};

export const deleteCategory = async (id: string): Promise<void> => {
  const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
};
