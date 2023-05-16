import { supabase } from "@/lib/supabase";
import { Subcategory } from "@/lib/types";

const TABLE_NAME = "subcategories";

export const getSubcategories = async (): Promise<Subcategory[]> => {
  const { data, error } = await supabase.from(TABLE_NAME).select("*");
  if (error) {
    throw new Error(`Error fetching ${TABLE_NAME}`);
  }

  return data as Subcategory[];
};

export const getSubcategoryById = async (
  id: string
): Promise<Subcategory | null> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Error fetching item with id ${id}`);
  }

  return data as Subcategory;
};

export const createSubcategory = async (
  item: Partial<Subcategory>
): Promise<Subcategory> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(item)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Subcategory;
};

export const updateSubcategory = async (
  id: string,
  item: Partial<Subcategory>
): Promise<Subcategory> => {
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

  return data as Subcategory;
};

export const deleteSubcategory = async (id: string): Promise<void> => {
  const { error } = await supabase.from(TABLE_NAME).delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
};
